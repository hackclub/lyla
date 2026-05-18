import {
  deleteCaseAction,
  getCaseByNumber,
  getCaseAssignees,
  getCaseActions,
} from "../lib/case-tracker.js";
import { buildCaseInfoView } from "../lib/modals.js";
import { isAuthorized } from "../lib/auth.js";

function register(app) {
  app.action("delete_case_action", async ({ ack, body, action, client }) => {
    await ack();

    if (!(await isAuthorized(body.user.id, client))) return;

    const parts = action.value.split(":");
    const actionId = parseInt(parts[0], 10);
    const caseNumber = parseInt(parts[1], 10);
    if (isNaN(actionId) || isNaN(caseNumber)) return;

    await deleteCaseAction(actionId);

    const [caseData, assignees, actions] = await Promise.all([
      getCaseByNumber(caseNumber),
      getCaseAssignees(caseNumber),
      getCaseActions(caseNumber),
    ]);
    if (!caseData) return;

    // Preserve any unsaved status/assignees the user had selected
    const stateValues = body.view?.state?.values ?? {};
    const currentStatus =
      stateValues.status?.status_select?.selected_option?.value ?? caseData.status;
    const currentAssigneeIds =
      stateValues.assignees?.assignees_input?.selected_users ?? assignees.map((a) => a.userId);

    const view = buildCaseInfoView({
      caseData: { ...caseData, status: currentStatus },
      assigneeIds: currentAssigneeIds,
      actions,
    });

    await client.views.update({ view_id: body.view.id, view });
  });
}

export default register;
