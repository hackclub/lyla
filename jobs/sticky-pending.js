import { ALLOWED_CHANNELS } from "../lib/config.js";
import { getOpenCases } from "../lib/case-tracker.js";
import { botClient } from "../lib/clients.js";
import { db } from "../lib/db.js";
import { appState } from "../db/schema.js";
import { eq } from "drizzle-orm";
import {
  threadUrl,
  timeAgo,
  truncateToWordBoundary,
  escapeMrkdwn,
  pingSafe,
  resolveMentions,
} from "../lib/slack-utils.js";

const FIREHOUSE_CHANNEL = ALLOWED_CHANNELS[0];
const COOLDOWN_MS = 3000;
const MAX_CASE_BLOCKS = 47; // leaves room for header + "N more" tail within Slack's 50-block limit

// in-memory snippet cache: "${channel}:${threadTs}" -> string
const snippetCache = new Map();

async function fetchSnippet(channel, threadTs) {
  const key = `${channel}:${threadTs}`;
  if (snippetCache.has(key)) return;
  try {
    const resp = await botClient.conversations.replies({
      channel,
      ts: threadTs,
      limit: 1,
      inclusive: true,
    });
    const raw = resp.messages?.[0]?.text ?? "";
    const text = await resolveMentions(raw);
    snippetCache.set(key, truncateToWordBoundary(text) || "View Thread");
  } catch {
    snippetCache.set(key, "View Thread");
  }
}

// display name cache: userId -> string
const displayNameCache = new Map();

async function fetchDisplayName(userId) {
  if (displayNameCache.has(userId)) return displayNameCache.get(userId);
  try {
    const resp = await botClient.users.info({ user: userId });
    const name = resp.user?.profile?.display_name || resp.user?.profile?.real_name || userId;
    displayNameCache.set(userId, name);
    return name;
  } catch {
    displayNameCache.set(userId, userId);
    return userId;
  }
}

const EMPTY_BLOCKS = [
  {
    type: "rich_text",
    elements: [
      {
        type: "rich_text_section",
        elements: [
          { type: "emoji", name: "tada" },
          { type: "text", text: " No unresolved threads!", style: { bold: true } },
        ],
      },
    ],
  },
];

async function buildBlocksFromCases(openCases) {
  if (openCases.length === 0) return EMPTY_BLOCKS;

  const sorted = [...openCases].sort((a, b) => a.createdAt - b.createdAt);

  // Fetch snippets for each primary thread
  await Promise.all(
    sorted.map((c) => {
      const primary = c.threads.find((t) => t.isPrimary) ?? c.threads[0];
      if (primary) return fetchSnippet(primary.channel, primary.threadTs);
    })
  );

  // Prune cache entries for cases that are no longer open
  const activeKeys = new Set(
    sorted.flatMap((c) => c.threads.map((t) => `${t.channel}:${t.threadTs}`))
  );
  for (const key of snippetCache.keys()) {
    if (!activeKeys.has(key)) snippetCache.delete(key);
  }

  const displayed = sorted.slice(0, MAX_CASE_BLOCKS);
  const overflow = sorted.length - displayed.length;

  // Resolve display names for all assignees
  const allAssigneeIds = [...new Set(displayed.flatMap((c) => c.assignees.map((a) => a.userId)))];
  await Promise.all(allAssigneeIds.map(fetchDisplayName));

  const caseBlocks = displayed.map((c, i) => {
    const primary = c.threads.find((t) => t.isPrimary) ?? c.threads[0];
    const snippet = primary
      ? (snippetCache.get(`${primary.channel}:${primary.threadTs}`) ?? "View Thread")
      : "View Thread";
    const ago = timeAgo(c.createdAt);

    let status;
    if (c.assignees.length === 0) {
      status = `unclaimed, ${ago}`;
    } else {
      const names = c.assignees
        .map((a) => pingSafe(displayNameCache.get(a.userId) ?? a.userId))
        .join(", ");
      status = `assigned to ${names}, ${ago}`;
    }

    const linkText = primary
      ? `<${threadUrl(primary.channel, primary.threadTs)}|${escapeMrkdwn(snippet)}>`
      : escapeMrkdwn(snippet);

    return {
      type: "section",
      block_id: `case_${i}`,
      text: {
        type: "mrkdwn",
        text: `*${i + 1}.* #\u200c${c.caseNumber} (${status})\n${linkText}`,
      },
      accessory: {
        type: "overflow",
        action_id: "thread_action",
        options: [
          {
            text: { type: "plain_text", text: "Claim", emoji: false },
            value: `claim:${c.caseNumber}`,
          },
        ],
      },
    };
  });

  const blocks = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: ":rotating_light: *Unresolved threads:*",
      },
    },
    ...caseBlocks,
  ];

  if (overflow > 0) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `_...and ${overflow} more_` },
    });
  }

  return blocks;
}

// cachedBlocks is undefined until first load
let cachedBlocks = undefined;
let stickyTs = undefined; // undefined = not yet loaded
let refreshInterval = null;

async function loadStickyTs() {
  if (stickyTs !== undefined) return;
  const rows = await db.select().from(appState).where(eq(appState.key, "stickyMessageTs"));
  stickyTs = rows[0]?.value ?? null;
}

async function persistStickyTs(ts) {
  stickyTs = ts; // update in-memory first so message handler sees it immediately
  await db
    .insert(appState)
    .values({ key: "stickyMessageTs", value: ts })
    .onConflictDoUpdate({ target: appState.key, set: { value: ts } });
}

async function postSticky() {
  const post = await botClient.chat.postMessage({
    channel: FIREHOUSE_CHANNEL,
    text: "Unresolved threads",
    blocks: cachedBlocks,
    unfurl_links: false,
    unfurl_media: false,
  });
  await Promise.all([
    botClient.pins
      .add({ channel: FIREHOUSE_CHANNEL, timestamp: post.ts })
      .catch((e) => console.error("Could not pin sticky:", e.message)),
    persistStickyTs(post.ts),
  ]);
}

// new message in channel, delete old sticky and repost with cached blocks
async function doReposition() {
  await loadStickyTs();

  if (cachedBlocks === undefined) {
    cachedBlocks = await buildBlocksFromCases(await getOpenCases());
  }

  const oldTs = stickyTs;
  await Promise.all([
    oldTs
      ? botClient.chat.delete({ channel: FIREHOUSE_CHANNEL, ts: oldTs }).catch(() => {})
      : Promise.resolve(),
    postSticky(),
  ]);
}

// thread tracking changed, rebuild blocks and update the sticky
async function doUpdate() {
  await loadStickyTs();

  const openCases = await getOpenCases();
  cachedBlocks = await buildBlocksFromCases(openCases);

  if (!refreshInterval) {
    refreshInterval = setInterval(() => enqueue(doUpdate), 60_000);
  }

  if (!stickyTs) {
    await postSticky();
    return;
  }

  await botClient.chat
    .update({
      channel: FIREHOUSE_CHANNEL,
      ts: stickyTs,
      text: "Unresolved threads",
      blocks: cachedBlocks,
    })
    .catch(async (e) => {
      // can't find it, maybe deleted manually? recreate and update ts
      console.error("chat.update failed, recreating sticky:", e.message);
      stickyTs = null;
      await postSticky();
    });
}

// serial operation chain, so doReposition and doUpdate never run at the same time
let opChain = Promise.resolve();
function enqueue(fn) {
  opChain = opChain.then(fn).catch(console.error);
}

// separate rate limiters for each type
// both allow a fresh one to go through immediately, then wait at least
// COOLDOWN_MS before allowing the next one

let pendingRepositionTimer = null;
let lastRepositionTime = 0;

let pendingUpdateTimer = null;
let lastUpdateTime = 0;

export function requestReposition() {
  const now = Date.now();
  const sinceLast = now - lastRepositionTime;
  if (sinceLast >= COOLDOWN_MS) {
    lastRepositionTime = now;
    enqueue(doReposition);
    return;
  }
  if (pendingRepositionTimer) return;
  pendingRepositionTimer = setTimeout(() => {
    pendingRepositionTimer = null;
    lastRepositionTime = Date.now();
    enqueue(doReposition);
  }, COOLDOWN_MS - sinceLast);
}

export function requestUpdate() {
  const now = Date.now();
  const sinceLast = now - lastUpdateTime;
  if (sinceLast >= COOLDOWN_MS) {
    lastUpdateTime = now;
    enqueue(doUpdate);
    return;
  }
  if (pendingUpdateTimer) return;
  pendingUpdateTimer = setTimeout(() => {
    pendingUpdateTimer = null;
    lastUpdateTime = Date.now();
    enqueue(doUpdate);
  }, COOLDOWN_MS - sinceLast);
}

export function register(app) {
  app.event("message", async ({ event }) => {
    if (event.channel !== FIREHOUSE_CHANNEL) return;
    if (event.subtype && event.subtype !== "bot_message" && event.subtype !== "thread_broadcast")
      return;
    if (event.thread_ts && event.thread_ts !== event.ts && event.subtype !== "thread_broadcast")
      return;
    await loadStickyTs();
    if (event.ts === stickyTs) return;
    requestReposition();
  });

  app.event("user_change", ({ event }) => {
    const user = event.user;
    if (!displayNameCache.has(user.id)) return;
    const newName = user.profile?.display_name || user.profile?.real_name || user.id;
    if (displayNameCache.get(user.id) === newName) return;
    displayNameCache.set(user.id, newName);
    requestUpdate();
  });
}
