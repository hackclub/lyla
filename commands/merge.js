import { getCaseByNumber, getCasePrimaryThread, mergeCase } from "../lib/case-tracker.js";
import { requestUpdate } from "../jobs/sticky-pending.js";
import { threadUrl } from "../lib/slack-utils.js";

// Parses "123 into 456" or "#123 into #456"
function parseArgs(text) {
  const m = text.trim().match(/^#?(\d+)\s+into\s+#?(\d+)$/i);
  if (!m) return null;
  return { from: parseInt(m[1], 10), to: parseInt(m[2], 10) };
}

function register(app) {
  app.command(/^\/(.*dev-)?lyla-merge$/, async ({ command, ack, client, respond }) => {
    await ack();

    const parsed = parseArgs(command.text);
    if (!parsed) {
      await respond({
        text: "Usage: `/lyla-merge [from] into [to]`",
        response_type: "ephemeral",
      });
      return;
    }

    const { from, to } = parsed;

    if (from === to) {
      await respond({ text: "A case cannot be merged into itself.", response_type: "ephemeral" });
      return;
    }

    const [fromCase, toCase] = await Promise.all([getCaseByNumber(from), getCaseByNumber(to)]);

    if (!fromCase) {
      await respond({ text: `Case #${from} not found.`, response_type: "ephemeral" });
      return;
    }
    if (!toCase) {
      await respond({ text: `Case #${to} not found.`, response_type: "ephemeral" });
      return;
    }
    if (fromCase.status === "merged") {
      await respond({
        text: `Case #${from} is already merged (into #${fromCase.mergedInto}).`,
        response_type: "ephemeral",
      });
      return;
    }
    if (toCase.status === "merged") {
      await respond({
        text: `Case #${to} is already merged (into #${toCase.mergedInto}).`,
        response_type: "ephemeral",
      });
      return;
    }

    const [fromThread, toThread] = await Promise.all([
      getCasePrimaryThread(from),
      getCasePrimaryThread(to),
    ]);

    await mergeCase(from, to);
    requestUpdate();

    const actor = `<@${command.user_id}>`;

    // Notify the from-case's primary thread
    if (fromThread) {
      const toLink = toThread
        ? `<${threadUrl(toThread.channel, toThread.threadTs)}|#‌${to}>`
        : `#‌${to}`;
      await client.chat
        .postMessage({
          channel: fromThread.channel,
          thread_ts: fromThread.threadTs,
          text: `${actor} merged this case (#‌${from}) into ${toLink}.`,
          unfurl_links: false,
          unfurl_media: false,
        })
        .catch(() => {});
    }

    // Notify the to-case's primary thread
    if (toThread) {
      const fromLink = fromThread
        ? `<${threadUrl(fromThread.channel, fromThread.threadTs)}|#‌${from}>`
        : `#‌${from}`;
      await client.chat
        .postMessage({
          channel: toThread.channel,
          thread_ts: toThread.threadTs,
          text: `${actor} merged case ${fromLink} into this case (#‌${to}).`,
          unfurl_links: false,
          unfurl_media: false,
        })
        .catch(() => {});
    }
  });
}

export default register;
