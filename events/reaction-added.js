const { ALLOWED_CHANNELS } = require("../lib/config");
const {
  threadTracker,
  makeThreadKey,
  ensureTrackedThread,
  findTrackedThreadByPendingMessage,
} = require("../lib/thread-tracker");
const { getConductPromptBlocks } = require("../lib/blocks");

const HOURGLASS_EMOJIS = ["hourglass", "hourglass_flowing_sand", "hourglass_not_done"];
const TICK_REACTIONS = ["heavy_check_mark", "white_tick", "white_check_mark", "check"];
const X_REACTIONS = ["x"];

function register(app) {
  app.event("reaction_added", async ({ event, client }) => {
    const channel = event.item.channel;
    const reaction = event.reaction;
    const isAllowedChannel = ALLOWED_CHANNELS.includes(channel);

    // Hourglass reactions: just track the thread
    if (isAllowedChannel && HOURGLASS_EMOJIS.includes(reaction)) {
      ensureTrackedThread(channel, event.item.ts);
    }

    // Ban reaction: track + post conduct-report prompt
    if (isAllowedChannel && reaction === "ban") {
      const threadData = ensureTrackedThread(channel, event.item.ts);
      threadData.conduct_prompt_sent = true;
      threadData.last_prompt_time = Date.now();

      await client.chat.postMessage({
        channel,
        thread_ts: event.item.ts,
        text: "Wanna file a conduct report?",
        blocks: getConductPromptBlocks(),
      });
      return;
    }

    // Bangbang reaction: broadcast "This thread needs attention!" on solo threads
    if (isAllowedChannel && reaction === "bangbang") {
      try {
        const messageResp = await client.conversations.history({
          channel,
          latest: event.item.ts,
          limit: 1,
          inclusive: true,
        });

        if (!messageResp.messages || messageResp.messages.length === 0) {
          return;
        }

        const message = messageResp.messages[0];
        const threadTs = message.thread_ts ? message.thread_ts : message.ts;

        const repliesResp = await client.conversations.replies({
          channel,
          ts: threadTs,
          limit: 2,
          inclusive: true,
        });

        if (repliesResp.messages && repliesResp.messages.length === 1) {
          await client.chat.postMessage({
            channel,
            text: "This thread needs attention!",
            thread_ts: threadTs,
            reply_broadcast: true,
          });
        }
      } catch (error) {
        console.error("Error:", error);
      }
      return;
    }

    // Resolve/cancel reactions: clear tracking + remove :bangbang:
    const isCancel = X_REACTIONS.includes(reaction);
    const isResolve = TICK_REACTIONS.includes(reaction);

    if ((isCancel || isResolve) && isAllowedChannel) {
      let threadKey = makeThreadKey(channel, event.item.ts);
      if (!threadTracker.has(threadKey)) {
        const found = findTrackedThreadByPendingMessage(channel, event.item.ts);
        if (found) {
          threadKey = found.key;
        }
      }

      if (!threadTracker.has(threadKey)) return;

      const threadData = threadTracker.get(threadKey);
      threadTracker.delete(threadKey);
      try {
        await client.reactions.remove({
          channel: threadData.channel,
          timestamp: threadData.thread_ts,
          name: "bangbang",
        });
      } catch (error) {
        // Likely the :bangbang: reaction was never added; safe to ignore.
      }
      return;
    }
  });
}

module.exports = register;
