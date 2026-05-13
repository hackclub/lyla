import { ALLOWED_CHANNELS } from "../lib/config.js";
import { threadTracker, makeThreadKey, ensureTrackedThread } from "../lib/thread-tracker.js";
import { getConductPromptBlocks } from "../lib/blocks.js";
import { requestRefresh } from "../jobs/sticky-pending.js";

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
      requestRefresh(client);
    }

    // Ban reaction: track + post conduct-report prompt
    if (isAllowedChannel && reaction === "ban") {
      ensureTrackedThread(channel, event.item.ts);

      await client.chat.postMessage({
        channel,
        thread_ts: event.item.ts,
        text: "Wanna file a conduct report?",
        blocks: getConductPromptBlocks(),
      });
      requestRefresh(client);
      return;
    }

    // Resolve/cancel reactions: clear tracking
    const isCancel = X_REACTIONS.includes(reaction);
    const isResolve = TICK_REACTIONS.includes(reaction);

    if ((isCancel || isResolve) && isAllowedChannel) {
      const threadKey = makeThreadKey(channel, event.item.ts);
      if (!threadTracker.has(threadKey)) return;

      threadTracker.delete(threadKey);
      requestRefresh(client);
      return;
    }
  });
}

export default register;
