import { ALLOWED_CHANNELS } from "../lib/config.js";
import { threadTracker } from "../lib/thread-tracker.js";

const FIREHOUSE_CHANNEL = ALLOWED_CHANNELS[0];
const WORKSPACE_DOMAIN = "hackclub.slack.com";

function threadUrl(channel, ts) {
  return `https://${WORKSPACE_DOMAIN}/archives/${channel}/p${ts.replace(".", "")}?thread_ts=${ts}`;
}

// Refresh fires immediately on the first request, then is rate-limited
// to at most once per COOLDOWN_MS. A trailing refresh inside the cooldown
// window catches any activity that happened during the wait.
const COOLDOWN_MS = 3000;

let stickyMessageTs = null;
let pendingTimer = null;
let lastRefreshTime = 0;
let isRefreshing = false;

function buildBlocks() {
  const open = [...threadTracker.values()].filter((t) => !t.report_filed);
  if (open.length === 0) return null;

  const listElements = open.map((t) => ({
    type: "rich_text_section",
    elements: [
      {
        type: "link",
        url: threadUrl(t.channel, t.thread_ts),
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
    const blocks = buildBlocks();

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
    stickyMessageTs = post.ts;

    try {
      await client.pins.add({
        channel: FIREHOUSE_CHANNEL,
        timestamp: stickyMessageTs,
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
    if (event.ts === stickyMessageTs) return;
    requestRefresh(client);
  });
}

export { register, refresh, requestRefresh };
