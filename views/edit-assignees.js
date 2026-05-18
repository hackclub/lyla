import { applyAssigneeChanges } from "../lib/assignee-utils.js";
import { isAuthorized, UNAUTHORIZED_TEXT } from "../lib/auth.js";

function register(app) {
  app.view("edit_assignees", async ({ ack, view, body, client }) => {
    if (!(await isAuthorized(body.user.id, client))) {
      await ack({ response_action: "errors", errors: { assignees: UNAUTHORIZED_TEXT } });
      return;
    }
    await ack();

    const { caseNumber, oldAssigneeIds } = JSON.parse(view.private_metadata);
    const newIds = view.state.values.assignees.assignees_input.selected_users ?? [];

    await applyAssigneeChanges(client, caseNumber, body.user.id, oldAssigneeIds ?? [], newIds);
  });
}

export default register;
