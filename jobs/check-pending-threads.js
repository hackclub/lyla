const { threadTracker } = require("../lib/thread-tracker");

async function checkPendingThreads(client) {
  const now = Date.now();

  const hourglassEmojis = ["hourglass", "hourglass_flowing_sand", "hourglass_not_done"];
  const tickReactions = ["heavy_check_mark", "white_tick", "white_check_mark", "check"];
  const xReactions = ["x"];

  for (const [threadKey, threadData] of threadTracker.entries()) {
    if (threadData.report_filed) {
      continue;
    }

    let rootMsg;
    try {
      const repliesResp = await client.conversations.replies({
        channel: threadData.channel,
        ts: threadData.thread_ts,
        limit: 1,
        inclusive: true,
      });
      rootMsg = repliesResp.messages && repliesResp.messages[0];
    } catch (err) {
      continue;
    }
    if (!rootMsg || !rootMsg.reactions) continue;

    const reactions = rootMsg.reactions.map((r) => r.name);
    const hasHourglass = reactions.some((r) => hourglassEmojis.includes(r));
    const hasTick = tickReactions.some((tick) => reactions.includes(tick));
    const hasX = xReactions.some((x) => reactions.includes(x));

    if (hasTick || hasX) {
      threadTracker.delete(threadKey);
      continue;
    }

    if (hasHourglass) {
      const lastTrigger =
        threadData.last_pending_msg_time ||
        threadData.last_prompt_time ||
        threadData.ban_reaction_time;
      const timeSinceLastTrigger = now - lastTrigger;
      const nineHours = 9 * 60 * 60 * 1000;
      if (timeSinceLastTrigger >= nineHours) {
        try {
          const pendingMessage = await client.chat.postMessage({
            channel: threadData.channel,
            thread_ts: threadData.thread_ts,
            text: "Pending…",
            reply_broadcast: true,
          });

          threadData.pending_message_ts = pendingMessage.ts;
          threadData.last_pending_msg_time = now;

          if (!reactions.includes("bangbang")) {
            await client.reactions.add({
              channel: threadData.channel,
              timestamp: threadData.thread_ts,
              name: "bangbang",
            });
          }
        } catch (error) {
          console.error(error);
        }
      }
    }
  }

  const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
  for (const [threadKey, threadData] of threadTracker.entries()) {
    if (now - threadData.ban_reaction_time > SEVEN_DAYS) {
      threadTracker.delete(threadKey);
    }
  }
}

module.exports = checkPendingThreads;
