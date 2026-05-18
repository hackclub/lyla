import { getCaseByNumber } from "../lib/case-tracker.js";
import { openCaseInfoModal } from "../lib/modals.js";
import { isAuthorized, UNAUTHORIZED_TEXT } from "../lib/auth.js";

function register(app) {
  app.command(/^\/(.*dev-)?lyla-case$/, async ({ command, ack, client, respond }) => {
    await ack();
    if (!(await isAuthorized(command.user_id, client))) {
      await respond({ text: UNAUTHORIZED_TEXT, response_type: "ephemeral" });
      return;
    }

    const caseNumber = parseInt(command.text.trim(), 10);
    if (isNaN(caseNumber)) {
      await respond({ text: "Usage: `/lyla-case [case number]`", response_type: "ephemeral" });
      return;
    }

    const caseData = await getCaseByNumber(caseNumber);
    if (!caseData) {
      await respond({ text: `Case #\u200c${caseNumber} not found`, response_type: "ephemeral" });
      return;
    }
    await openCaseInfoModal(client, command.trigger_id, caseNumber);
  });
}

export default register;
