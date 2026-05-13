import { ALLOWED_CHANNELS } from "../lib/config.js";
import { addThread, getThread, removeThread } from "../lib/thread-tracker.js";
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
      await addThread(channel, event.item.ts, Date.now());
      requestRefresh(client);
    }

    // Ban reaction: track + post conduct-report prompt
    if (isAllowedChannel && reaction === "ban") {
      await addThread(channel, event.item.ts, Date.now());

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
      const thread = await getThread(channel, event.item.ts);
      if (!thread) return;

      await removeThread(channel, event.item.ts);
      requestRefresh(client);
      return;
    }
  });
}

export default register;
