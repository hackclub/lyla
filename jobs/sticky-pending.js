import { ALLOWED_CHANNELS } from "../lib/config.js";
import { getAllThreads } from "../lib/thread-tracker.js";
import { botClient } from "../lib/clients.js";
import { db } from "../lib/db.js";
import { appState } from "../db/schema.js";
import { eq } from "drizzle-orm";

const FIREHOUSE_CHANNEL = ALLOWED_CHANNELS[0];
const WORKSPACE_DOMAIN = "hackclub.slack.com";
const COOLDOWN_MS = 3000;

function threadUrl(channel, ts) {
  return `https://${WORKSPACE_DOMAIN}/archives/${channel}/p${ts.replace(".", "")}?thread_ts=${ts}`;
}

function fallbackText(timestampMs) {
  const diffMs = Date.now() - timestampMs;
  if (diffMs < 0 || diffMs > 30 * 24 * 60 * 60 * 1000) {
    return new Date(timestampMs).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return mins <= 1 ? "1 minute ago" : `${mins} minutes ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

async function resolveMentions(text) {
  const userIds = [...new Set([...text.matchAll(/<@([A-Z0-9]+)(?:\|[^>]*)?>/g)].map((m) => m[1]))];
  const channelIds = [...new Set([...text.matchAll(/<#([A-Z0-9]+)(?:\|[^>]*)?>/g)].map((m) => m[1]))];

  const [userEntries, channelEntries] = await Promise.all([
    Promise.all(
      userIds.map(async (id) => {
        try {
          const resp = await botClient.users.info({ user: id });
          const name = resp.user?.profile?.display_name || resp.user?.profile?.real_name;
          return [id, name ? `@${name}` : null];
        } catch {
          return [id, null];
        }
      })
    ),
    Promise.all(
      channelIds.map(async (id) => {
        try {
          const resp = await botClient.conversations.info({ channel: id });
          return [id, resp.channel?.name ? `#${resp.channel.name}` : null];
        } catch {
          return [id, null];
        }
      })
    ),
  ]);

  const userMap = new Map(userEntries.filter(([, v]) => v));
  const channelMap = new Map(channelEntries.filter(([, v]) => v));

  return text
    .replace(/<@([A-Z0-9]+)(?:\|[^>]*)?>/g, (match, id) => userMap.get(id) ?? match)
    .replace(/<#([A-Z0-9]+)(?:\|[^>]*)?>/g, (match, id) => channelMap.get(id) ?? match);
}

function truncateToWordBoundary(text, maxLen = 100) {
  const trimmed = text
    .split("\n")
    .map((line) => line.trim())
    .join(" ");
  if (trimmed.length <= maxLen) return trimmed;
  const sub = trimmed.slice(0, maxLen);
  const lastSpace = sub.lastIndexOf(" ");
  return (lastSpace > 0 ? sub.slice(0, lastSpace) : sub).trim() + "...";
}

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

async function buildBlocksFromThreads(threads) {
  if (threads.length === 0) return null;

  const sorted = [...threads].sort((a, b) => a.banReactionTime - b.banReactionTime);

  await Promise.all(sorted.map((t) => fetchSnippet(t.channel, t.threadTs)));

  // prune cache entries for threads that no longer exist
  const activeKeys = new Set(sorted.map((t) => `${t.channel}:${t.threadTs}`));
  for (const key of snippetCache.keys()) {
    if (!activeKeys.has(key)) snippetCache.delete(key);
  }

  return [
    {
      type: "rich_text",
      elements: [
        {
          type: "rich_text_section",
          elements: [
            { type: "emoji", name: "rotating_light" },
            { type: "text", text: " " },
            { type: "text", text: "Unresolved threads:", style: { bold: true } },
            { type: "text", text: "\n" },
          ],
        },
        {
          type: "rich_text_list",
          style: "ordered",
          elements: sorted.map((t) => ({
            type: "rich_text_section",
            elements: [
              {
                type: "link",
                url: threadUrl(t.channel, t.threadTs),
                text: snippetCache.get(`${t.channel}:${t.threadTs}`),
              },
              { type: "text", text: " (" },
              {
                type: "date",
                timestamp: Math.floor(t.banReactionTime / 1000),
                format: "{ago}",
                fallback: fallbackText(t.banReactionTime),
              },
              { type: "text", text: ")" },
            ],
          })),
        },
      ],
    },
  ];
}

// cachedBlocks is undefined until first load (null means no threads)
let cachedBlocks = undefined;
let stickyTs = undefined; // undefined = not yet loaded
let refreshInterval = null;

function startRefreshInterval() {
  if (refreshInterval) return;
  refreshInterval = setInterval(() => {
    if (cachedBlocks) enqueue(doUpdate);
  }, 60_000);
}

function stopRefreshInterval() {
  if (!refreshInterval) return;
  clearInterval(refreshInterval);
  refreshInterval = null;
}

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
    cachedBlocks = await buildBlocksFromThreads(await getAllThreads());
  }

  if (!cachedBlocks) {
    // nothing to show, just clear any existing sticky
    if (stickyTs) {
      await botClient.chat.delete({ channel: FIREHOUSE_CHANNEL, ts: stickyTs }).catch(() => {});
      await persistStickyTs(null);
    }
    return;
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

  cachedBlocks = await buildBlocksFromThreads(await getAllThreads());

  if (!cachedBlocks) {
    stopRefreshInterval();
    if (stickyTs) {
      await botClient.chat.delete({ channel: FIREHOUSE_CHANNEL, ts: stickyTs }).catch(() => {});
      await persistStickyTs(null);
    }
    return;
  }

  startRefreshInterval();

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
    if (event.subtype && event.subtype !== "bot_message") return;
    if (event.thread_ts && event.thread_ts !== event.ts) return;
    await loadStickyTs();
    if (event.ts === stickyTs) return;
    requestReposition();
  });
}
