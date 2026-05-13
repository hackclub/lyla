import { ALLOWED_CHANNELS } from "../lib/config.js";
import { getAllThreads } from "../lib/thread-tracker.js";
import { db } from "../lib/db.js";
import { appState } from "../db/schema.js";
import { eq } from "drizzle-orm";

const FIREHOUSE_CHANNEL = ALLOWED_CHANNELS[0];
const WORKSPACE_DOMAIN = "hackclub.slack.com";

function threadUrl(channel, ts) {
  return `https://${WORKSPACE_DOMAIN}/archives/${channel}/p${ts.replace(".", "")}?thread_ts=${ts}`;
}

// Refresh fires immediately on the first request, then is rate-limited
// to at most once per COOLDOWN_MS. A trailing refresh inside the cooldown
// window catches any activity that happened during the wait.
const COOLDOWN_MS = 3000;

let pendingTimer = null;
let lastRefreshTime = 0;
let isRefreshing = false;

async function getStickyTs() {
  const rows = await db.select().from(appState).where(eq(appState.key, "stickyMessageTs"));
  return rows[0]?.value ?? null;
}

async function setStickyTs(ts) {
  await db
    .insert(appState)
    .values({ key: "stickyMessageTs", value: ts })
    .onConflictDoUpdate({ target: appState.key, set: { value: ts } });
}

async function buildBlocks() {
  const threads = await getAllThreads();
  if (threads.length === 0) return null;

  const listElements = threads.map((t) => ({
    type: "rich_text_section",
    elements: [
      {
        type: "link",
        url: threadUrl(t.channel, t.threadTs),
        text: "View Thread",
      },
    ],
  }));

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
          elements: listElements,
        },
      ],
    },
  ];
}

async function refresh(client) {
  if (isRefreshing) return;
  isRefreshing = true;
  try {
    const blocks = await buildBlocks();
    let stickyMessageTs = await getStickyTs();

    // Tear down the old sticky if any.
    if (stickyMessageTs) {
      try {
        await client.pins.remove({
          channel: FIREHOUSE_CHANNEL,
          timestamp: stickyMessageTs,
        });
      } catch {
        // Pin may already be gone; ignore.
      }
      try {
        await client.chat.delete({
          channel: FIREHOUSE_CHANNEL,
          ts: stickyMessageTs,
        });
      } catch {
        // Message may already be gone; ignore.
      }
      await setStickyTs(null);
      stickyMessageTs = null;
    }

    if (!blocks) return; // Nothing to display.

    const post = await client.chat.postMessage({
      channel: FIREHOUSE_CHANNEL,
      text: "Threads awaiting action",
      blocks,
      unfurl_links: false,
      unfurl_media: false,
    });
    await setStickyTs(post.ts);

    try {
      await client.pins.add({
        channel: FIREHOUSE_CHANNEL,
        timestamp: post.ts,
      });
    } catch (e) {
      console.error("Could not pin sticky:", e.message);
    }
  } finally {
    isRefreshing = false;
  }
}

function requestRefresh(client) {
  const now = Date.now();
  const sinceLast = now - lastRefreshTime;

  if (sinceLast >= COOLDOWN_MS) {
    // Cooldown elapsed: fire immediately.
    lastRefreshTime = now;
    refresh(client).catch(console.error);
    return;
  }

  // Inside the cooldown window: schedule a single trailing refresh.
  if (pendingTimer) return;
  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    lastRefreshTime = Date.now();
    refresh(client).catch(console.error);
  }, COOLDOWN_MS - sinceLast);
}

function register(app) {
  app.event("message", async ({ event, client }) => {
    if (event.channel !== FIREHOUSE_CHANNEL) return;
    if (event.subtype && event.subtype !== "bot_message") return;
    if (event.thread_ts && event.thread_ts !== event.ts) return;
    const stickyTs = await getStickyTs();
    if (event.ts === stickyTs) return;
    requestRefresh(client);
  });
}

export { register, refresh, requestRefresh };
