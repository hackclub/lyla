import { getAllThreads, removeThread } from "../lib/thread-tracker.js";
import { botClient } from "../lib/clients.js";
import { requestUpdate } from "./sticky-pending.js";

const TICK_REACTIONS = ["heavy_check_mark", "white_tick", "white_check_mark", "check"];
const X_REACTIONS = ["x"];
const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

// Walks the tracker, prunes resolved/expired entries, then asks the sticky
// to refresh if anything changed.
async function checkPendingThreads() {
  const now = Date.now();
  let changed = false;

  const threads = await getAllThreads();

  for (const threadData of threads) {
    let rootMsg;
    try {
      const repliesResp = await botClient.conversations.replies({
        channel: threadData.channel,
        ts: threadData.threadTs,
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
      await removeThread(threadData.channel, threadData.threadTs);
      changed = true;
    }
  }

  for (const threadData of threads) {
    if (now - threadData.banReactionTime > SEVEN_DAYS) {
      await removeThread(threadData.channel, threadData.threadTs);
      changed = true;
    }
  }

  if (changed) requestUpdate();
}

export default checkPendingThreads;
