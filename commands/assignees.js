import { getCaseByNumber } from "../lib/case-tracker.js";
import { openEditAssigneesModal } from "../lib/modals.js";
import { isAuthorized, UNAUTHORIZED_TEXT } from "../lib/auth.js";

function register(app) {
  app.command(/^\/(.*dev-|demo-)?lyla-assignees$/, async ({ command, ack, client, respond }) => {
    await ack();
    if (!(await isAuthorized(command.user_id, client))) {
      await respond({ text: UNAUTHORIZED_TEXT, response_type: "ephemeral" });
      return;
    }

    const caseNumber = parseInt(command.text.trim(), 10);
    if (isNaN(caseNumber)) {
      await respond({ text: "Usage: `/lyla-assignees [case number]`", response_type: "ephemeral" });
      return;
    }

    const caseData = await getCaseByNumber(caseNumber);
    if (!caseData) {
      await respond({ text: `Case #${caseNumber} not found`, response_type: "ephemeral" });
      return;
    }

    await openEditAssigneesModal(client, command.trigger_id, caseNumber);
  });
}

export default register;
