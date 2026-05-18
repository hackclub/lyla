import { setCaseStatus } from "../lib/case-tracker.js";
import { applyAssigneeChanges } from "../lib/assignee-utils.js";
import { isAuthorized, UNAUTHORIZED_TEXT } from "../lib/auth.js";

function register(app) {
  app.view("case_info", async ({ ack, view, body, client }) => {
    if (!(await isAuthorized(body.user.id, client))) {
      await ack({ response_action: "errors", errors: { status: UNAUTHORIZED_TEXT } });
      return;
    }
    await ack();

    const { caseNumber, oldAssigneeIds } = JSON.parse(view.private_metadata);
    const newStatus = view.state.values.status.status_select.selected_option.value;
    const newAssigneeIds = view.state.values.assignees.assignees_input.selected_users ?? [];

    await Promise.all([
      setCaseStatus(caseNumber, newStatus, body.user.id),
      applyAssigneeChanges(client, caseNumber, body.user.id, oldAssigneeIds ?? [], newAssigneeIds),
    ]);
  });
}

export default register;
