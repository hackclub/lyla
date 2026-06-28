import { botClient } from "./clients.js";

const WORKSPACE_DOMAIN = "hackclub.slack.com";
const BASE_TICK_REACTIONS = ["heavy_check_mark", "white_tick", "white_check_mark", "check"];
export function isTickReaction(reaction) {
  return BASE_TICK_REACTIONS.includes(reaction) || /^check-.+/.test(reaction);
}

export function joinList(items) {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return items.slice(0, -1).join(", ") + `, and ${items[items.length - 1]}`;
}

export function threadUrl(channel, ts) {
  return `https://${WORKSPACE_DOMAIN}/archives/${channel}/p${ts.replace(".", "")}?thread_ts=${ts}`;
}

export function timeAgo(timestampMs) {
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

export function truncateToWordBoundary(text, maxLen = 100) {
  const trimmed = text
    .split("\n")
    .map((line) => line.trim())
    .join(" ");
  if (trimmed.length <= maxLen) return trimmed;
  const sub = trimmed.slice(0, maxLen);
  const lastSpace = sub.lastIndexOf(" ");
  return (lastSpace > 0 ? sub.slice(0, lastSpace) : sub).trim() + "...";
}

// Escape user-supplied text for safe embedding in Slack mrkdwn.
// Encodes HTML special chars and breaks @ triggers (including the plain
// @channel/@here exploit that bypasses Slack's permission checks).
export function escapeMrkdwn(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("@", "@\u200c");
}

// Break up a display name with ZWNJs so Slack won't treat
// it as a pingword trigger when it appears in message text.
export function pingSafe(string) {
  return string.split("").join("\u200c");
}

// Break bare URLs with ZWNJs so Slack doesn't detect them
export function breakUrls(text) {
  return text.replace(/https?:\/\/\S+/g, (url) => pingSafe(url));
}

export async function resolveMentions(text) {
  const userIds = [...new Set([...text.matchAll(/<@([A-Z0-9]+)(?:\|[^>]*)?>/g)].map((m) => m[1]))];
  const channelIds = [
    ...new Set([...text.matchAll(/<#([A-Z0-9]+)(?:\|[^>]*)?>/g)].map((m) => m[1])),
  ];

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
