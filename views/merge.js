import { getCaseByNumber, getCasePrimaryThread, mergeCase } from "../lib/case-tracker.js";
import { requestUpdate } from "../jobs/sticky-pending.js";
import { threadUrl } from "../lib/slack-utils.js";
import { isAuthorized, UNAUTHORIZED_TEXT } from "../lib/auth.js";

function register(app) {
  app.view("merge_cases", async ({ ack, view, body, client }) => {
    if (!await isAuthorized(body.user.id, client)) {
      await ack({ response_action: "errors", errors: { from_case: UNAUTHORIZED_TEXT } });
      return;
    }

    const fromNum = parseInt(view.state.values.from_case.case_select.selected_option?.value, 10);
    const toNum = parseInt(view.state.values.to_case.case_select.selected_option?.value, 10);

    if (fromNum === toNum) {
      await ack({
        response_action: "errors",
        errors: { to_case: "Cannot merge a case into itself." },
      });
      return;
    }

    const [fromCase, toCase] = await Promise.all([
      getCaseByNumber(fromNum),
      getCaseByNumber(toNum),
    ]);

    if (!fromCase) {
      await ack({ response_action: "errors", errors: { from_case: `Case #${fromNum} not found` } });
      return;
    }
    if (fromCase.status === "merged") {
      await ack({
        response_action: "errors",
        errors: { from_case: `Case #${fromNum} is already merged (into #${fromCase.mergedInto})` },
      });
      return;
    }
    if (!toCase) {
      await ack({ response_action: "errors", errors: { to_case: `Case #${toNum} not found` } });
      return;
    }
    if (toCase.status === "merged") {
      await ack({
        response_action: "errors",
        errors: { to_case: `Case #${toNum} is already merged (into #${toCase.mergedInto})` },
      });
      return;
    }

    await ack();

    const [fromThread, toThread] = await Promise.all([
      getCasePrimaryThread(fromNum),
      getCasePrimaryThread(toNum),
    ]);

    await mergeCase(fromNum, toNum);
    requestUpdate();

    const actor = `<@${body.user.id}>`;

    if (fromThread) {
      const toLink = toThread
        ? `<${threadUrl(toThread.channel, toThread.threadTs)}|#\u200c${toNum}>`
        : `#\u200c${toNum}`;
      await client.chat
        .postMessage({
          channel: fromThread.channel,
          thread_ts: fromThread.threadTs,
          text: `${actor} merged this case (#\u200c${fromNum}) into ${toLink}`,
          unfurl_links: false,
          unfurl_media: false,
        })
        .catch(() => {});
    }

    if (toThread) {
      const fromLink = fromThread
        ? `<${threadUrl(fromThread.channel, fromThread.threadTs)}|#\u200c${fromNum}>`
        : `#\u200c${fromNum}`;
      await client.chat
        .postMessage({
          channel: toThread.channel,
          thread_ts: toThread.threadTs,
          text: `${actor} merged case ${fromLink} into this case (#\u200c${toNum})`,
          unfurl_links: false,
          unfurl_media: false,
        })
        .catch(() => {});
    }
  });
}

export default register;
