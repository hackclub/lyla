import { setAssignees } from "../lib/case-tracker.js";
import { requestUpdate } from "../jobs/sticky-pending.js";

function register(app) {
  app.view("edit_assignees", async ({ ack, view }) => {
    await ack();

    const { caseNumber } = JSON.parse(view.private_metadata);
    const userIds = view.state.values.assignees.assignees_input.selected_users ?? [];

    await setAssignees(caseNumber, userIds);
    requestUpdate();
  });
}

export default register;
