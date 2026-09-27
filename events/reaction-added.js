import { ALLOWED_CHANNELS } from "../lib/config.js";
import { createCase, getCaseByThread, resolveCase, storeSnippet } from "../lib/case-tracker.js";
import { getConductPromptBlocks } from "../lib/blocks.js";
import { requestUpdate } from "../jobs/sticky-pending.js";
import { isTickReaction } from "../lib/slack-utils.js";

const HOURGLASS_EMOJIS = ["hourglass", "hourglass_flowing_sand", "hourglass_not_done"];
const X_REACTIONS = ["x"];

async function resolveThread(client, channel, messageTs) {
  try {
    const resp = await client.conversations.replies({
      channel,
      ts: messageTs,
      limit: 1,
      inclusive: true,
    });
    const message = resp.messages?.[0];
    if (!message) return { threadTs: messageTs, rootText: null };
    const threadTs = message.thread_ts || message.ts;
    return { threadTs, rootText: message.ts === threadTs ? (message.text ?? null) : null };
  } catch {
    return { threadTs: messageTs, rootText: null };
  }
}

function fillSnippet(channel, threadTs, rootText) {
  storeSnippet(channel, threadTs, rootText)
    .then((stored) => {
      if (stored) requestUpdate();
    })
    .catch((e) => console.error("Could not store case snippet:", e.message));
}

function register(app) {
  app.event("reaction_added", async ({ event, client }) => {
    const channel = event.item.channel;
    const reaction = event.reaction;
    const isAllowedChannel = ALLOWED_CHANNELS.includes(channel);
    if (!isAllowedChannel) return;

    const isHourglass = HOURGLASS_EMOJIS.includes(reaction);
    const isBan = reaction === "ban";
    const isCancel = X_REACTIONS.includes(reaction);
    const isResolve = isTickReaction(reaction);

    if (!isHourglass && !isBan && !isCancel && !isResolve) return;

    const { threadTs, rootText } = await resolveThread(client, channel, event.item.ts);

    // Hourglass reactions: open a case for this thread
    if (isHourglass) {
      const caseData = await createCase(channel, threadTs, Date.now());
      if (caseData?.isNew) {
        await client.chat
          .postMessage({
            channel,
            thread_ts: threadTs,
            text: `Case #\u200c${caseData.caseNumber}`,
          })
          .catch((e) => console.error("Could not post case number:", e.message));
        fillSnippet(channel, threadTs, rootText);
      }
      requestUpdate();
      return;
    }

    // Ban reaction: open a case + post conduct-report prompt
    if (isBan) {
      const caseData = await createCase(channel, threadTs, Date.now());

      await client.chat
        .postMessage({
          channel,
          thread_ts: threadTs,
          text: "Wanna file a conduct report?",
          blocks: getConductPromptBlocks(),
        })
        .catch((e) => console.error("Could not post conduct prompt:", e.message));
      if (caseData?.isNew) fillSnippet(channel, threadTs, rootText);
      requestUpdate();
      return;
    }

    // Resolve/cancel reactions: close the case
    if (event.item.ts !== threadTs) return;
    const caseData = await getCaseByThread(channel, threadTs);
    if (!caseData) return;

    await resolveCase(caseData.caseNumber, event.user, isCancel ? "canceled" : "resolved");
    requestUpdate();
  });
}

export default register;
