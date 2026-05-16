import { getOpenCases, resolveCase } from "../lib/case-tracker.js";
import { botClient } from "../lib/clients.js";
import { requestUpdate } from "./sticky-pending.js";

const TICK_REACTIONS = ["heavy_check_mark", "white_tick", "white_check_mark", "check"];
const X_REACTIONS = ["x"];
const EXPIRY_TIME = 10 * 24 * 60 * 60 * 1000;

// Walks the tracker, prunes resolved/expired entries, then asks the sticky
// to refresh if anything changed.
async function checkPendingThreads() {
  const now = Date.now();
  let changed = false;

  const openCases = await getOpenCases();

  for (const caseData of openCases) {
    const primaryThread = caseData.threads.find((t) => t.isPrimary) ?? caseData.threads[0];
    if (!primaryThread) continue;

    const expired = now - caseData.createdAt > EXPIRY_TIME;

    let reactions = [];
    try {
      const resp = await botClient.conversations.replies({
        channel: primaryThread.channel,
        ts: primaryThread.threadTs,
        limit: 1,
        inclusive: true,
      });
      reactions = resp.messages?.[0]?.reactions?.map((r) => r.name) ?? [];
    } catch {
      if (!expired) continue;
    }

    const hasTick = TICK_REACTIONS.some((r) => reactions.includes(r));
    const hasX = X_REACTIONS.some((r) => reactions.includes(r));

    if (hasTick || hasX || expired) {
      const kind = hasTick ? "resolved" : hasX ? "canceled" : "expired";
      await resolveCase(caseData.caseNumber, null, kind);
      changed = true;
    }
  }

  if (changed) requestUpdate();
}

export default checkPendingThreads;
