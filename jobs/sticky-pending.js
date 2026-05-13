import { ALLOWED_CHANNELS } from "../lib/config.js";
import { getAllThreads } from "../lib/thread-tracker.js";
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

function buildBlocksFromThreads(threads) {
  if (threads.length === 0) return null;
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
          elements: threads.map((t) => ({
            type: "rich_text_section",
            elements: [
              { type: "link", url: threadUrl(t.channel, t.threadTs), text: "View Thread" },
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
let storedClient = null;
let refreshInterval = null;

function startRefreshInterval() {
  if (refreshInterval) return;
  refreshInterval = setInterval(() => {
    if (storedClient && cachedBlocks) enqueue(() => doUpdate(storedClient));
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

async function postSticky(client) {
  const post = await client.chat.postMessage({
    channel: FIREHOUSE_CHANNEL,
    text: "Unresolved threads",
    blocks: cachedBlocks,
    unfurl_links: false,
    unfurl_media: false,
  });
  await Promise.all([
    client.pins
      .add({ channel: FIREHOUSE_CHANNEL, timestamp: post.ts })
      .catch((e) => console.error("Could not pin sticky:", e.message)),
    persistStickyTs(post.ts),
  ]);
}

// new message in channel, delete old sticky and repost with cached blocks
async function doReposition(client) {
  await loadStickyTs();

  if (cachedBlocks === undefined) {
    cachedBlocks = buildBlocksFromThreads(await getAllThreads());
  }

  if (!cachedBlocks) {
    // nothing to show, just clear any existing sticky
    if (stickyTs) {
      await client.chat.delete({ channel: FIREHOUSE_CHANNEL, ts: stickyTs }).catch(() => {});
      await persistStickyTs(null);
    }
    return;
  }

  const oldTs = stickyTs;
  await Promise.all([
    oldTs
      ? client.chat.delete({ channel: FIREHOUSE_CHANNEL, ts: oldTs }).catch(() => {})
      : Promise.resolve(),
    postSticky(client),
  ]);
}

// thread tracking changed, rebuild blocks and update the sticky
async function doUpdate(client) {
  await loadStickyTs();

  cachedBlocks = buildBlocksFromThreads(await getAllThreads());

  if (!cachedBlocks) {
    stopRefreshInterval();
    if (stickyTs) {
      await client.chat.delete({ channel: FIREHOUSE_CHANNEL, ts: stickyTs }).catch(() => {});
      await persistStickyTs(null);
    }
    return;
  }

  startRefreshInterval();

  if (!stickyTs) {
    await postSticky(client);
    return;
  }

  await client.chat
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
      await postSticky(client);
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

export function requestReposition(client) {
  storedClient = client;
  const now = Date.now();
  const sinceLast = now - lastRepositionTime;
  if (sinceLast >= COOLDOWN_MS) {
    lastRepositionTime = now;
    enqueue(() => doReposition(client));
    return;
  }
  if (pendingRepositionTimer) return;
  pendingRepositionTimer = setTimeout(() => {
    pendingRepositionTimer = null;
    lastRepositionTime = Date.now();
    enqueue(() => doReposition(client));
  }, COOLDOWN_MS - sinceLast);
}

export function requestUpdate(client) {
  storedClient = client;
  const now = Date.now();
  const sinceLast = now - lastUpdateTime;
  if (sinceLast >= COOLDOWN_MS) {
    lastUpdateTime = now;
    enqueue(() => doUpdate(client));
    return;
  }
  if (pendingUpdateTimer) return;
  pendingUpdateTimer = setTimeout(() => {
    pendingUpdateTimer = null;
    lastUpdateTime = Date.now();
    enqueue(() => doUpdate(client));
  }, COOLDOWN_MS - sinceLast);
}

export function register(app) {
  app.event("message", async ({ event, client }) => {
    if (event.channel !== FIREHOUSE_CHANNEL) return;
    if (event.subtype && event.subtype !== "bot_message") return;
    if (event.thread_ts && event.thread_ts !== event.ts) return;
    await loadStickyTs();
    if (event.ts === stickyTs) return;
    requestReposition(client);
  });
}
