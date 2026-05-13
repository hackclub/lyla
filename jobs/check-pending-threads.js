import { threadTracker } from "../lib/thread-tracker.js";
import { requestRefresh } from "./sticky-pending.js";

const TICK_REACTIONS = ["heavy_check_mark", "white_tick", "white_check_mark", "check"];
const X_REACTIONS = ["x"];
const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

// Walks the tracker, prunes resolved/expired entries, then asks the sticky
// to refresh if anything changed.
async function checkPendingThreads(client) {
  const now = Date.now();
  let changed = false;

  for (const [threadKey, threadData] of threadTracker.entries()) {
    if (threadData.report_filed) continue;

    let rootMsg;
    try {
      const repliesResp = await client.conversations.replies({
        channel: threadData.channel,
        ts: threadData.thread_ts,
        limit: 1,
        inclusive: true,
      });
      rootMsg = repliesResp.messages && repliesResp.messages[0];
    } catch {
      continue;
    }
    if (!rootMsg || !rootMsg.reactions) continue;

    const reactions = rootMsg.reactions.map((r) => r.name);
    const hasTick = TICK_REACTIONS.some((r) => reactions.includes(r));
    const hasX = X_REACTIONS.some((r) => reactions.includes(r));

    if (hasTick || hasX) {
      threadTracker.delete(threadKey);
      changed = true;
    }
  }

  for (const [threadKey, threadData] of threadTracker.entries()) {
    if (now - threadData.ban_reaction_time > SEVEN_DAYS) {
      threadTracker.delete(threadKey);
      changed = true;
    }
  }

  if (changed) requestRefresh(client);
}

export default checkPendingThreads;
