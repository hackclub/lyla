import { getCaseByNumber } from "../lib/case-tracker.js";
import { openEditAssigneesModal } from "../lib/modals.js";

function register(app) {
  app.command(/^\/(.*dev-)?lyla-assignees$/, async ({ command, ack, client, respond }) => {
    await ack();

    const caseNumber = parseInt(command.text.trim(), 10);
    if (isNaN(caseNumber)) {
      await respond({ text: "Usage: `/lyla-assignees [case number]`", response_type: "ephemeral" });
      return;
    }

    const caseData = await getCaseByNumber(caseNumber);
    if (!caseData) {
      await respond({ text: `Case #${caseNumber} not found.`, response_type: "ephemeral" });
      return;
    }

    await openEditAssigneesModal(client, command.trigger_id, caseNumber);
  });
}

export default register;
