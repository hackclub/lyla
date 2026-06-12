import { FIREHOUSE_CHANNEL } from "./config.js";

const CACHE_TTL_MS = 60_000;

let membersCache = null;
let cacheExpiry = 0;

export async function isAuthorized(userId, client) {
  const now = Date.now();
  if (!membersCache || now > cacheExpiry) {
    const members = [];
    let cursor;
    do {
      const resp = await client.conversations.members({
        channel: FIREHOUSE_CHANNEL,
        limit: 1000,
        ...(cursor ? { cursor } : {}),
      });
      members.push(...resp.members);
      cursor = resp.response_metadata?.next_cursor || null;
    } while (cursor);
    membersCache = new Set(members);
    cacheExpiry = now + CACHE_TTL_MS;
  }
  return membersCache.has(userId);
}

export const UNAUTHORIZED_TEXT = `You must be a member of the Fire Department to do this.`;
