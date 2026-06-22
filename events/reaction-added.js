import { ALLOWED_CHANNELS } from "../lib/config.js";
import { createCase, getCaseByThread, resolveCase } from "../lib/case-tracker.js";
import { getConductPromptBlocks } from "../lib/blocks.js";
import { requestUpdate } from "../jobs/sticky-pending.js";

const HOURGLASS_EMOJIS = ["hourglass", "hourglass_flowing_sand", "hourglass_not_done"];
const TICK_REACTIONS = ["heavy_check_mark", "white_tick", "white_check_mark", "check"];
const X_REACTIONS = ["x"];

function register(app) {
  app.event("reaction_added", async ({ event, client }) => {
    const channel = event.item.channel;
    const reaction = event.reaction;
    const isAllowedChannel = ALLOWED_CHANNELS.includes(channel);

    // Hourglass reactions: open a case for this thread
    if (isAllowedChannel && HOURGLASS_EMOJIS.includes(reaction)) {
      const caseData = await createCase(channel, event.item.ts, Date.now());
      if (caseData?.isNew) {
        await client.chat
          .postMessage({
            channel,
            thread_ts: event.item.ts,
            text: `Case #\u200c${caseData.caseNumber}`,
          })
          .catch((e) => console.error("Could not post case number:", e.message));
      }
      requestUpdate();
    }

    // Ban reaction: open a case + post conduct-report prompt
    if (isAllowedChannel && reaction === "ban") {
      await createCase(channel, event.item.ts, Date.now());

      await client.chat
        .postMessage({
          channel,
          thread_ts: event.item.ts,
          text: "Wanna file a conduct report?",
          blocks: getConductPromptBlocks(),
        })
        .catch((e) => console.error("Could not post conduct prompt:", e.message));
      requestUpdate();
      return;
    }

    // Resolve/cancel reactions: close the case
    const isCancel = X_REACTIONS.includes(reaction);
    const isResolve = TICK_REACTIONS.includes(reaction);

    if ((isCancel || isResolve) && isAllowedChannel) {
      const caseData = await getCaseByThread(channel, event.item.ts);
      if (!caseData) return;

      await resolveCase(caseData.caseNumber, event.user, isCancel ? "canceled" : "resolved");
      requestUpdate();
    }
  });
}

export default register;
