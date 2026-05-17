import { getCaseAssignees } from "./case-tracker.js";

export async function openEditAssigneesModal(client, triggerId, caseNumber) {
  const assignees = await getCaseAssignees(caseNumber);
  const currentIds = assignees.map((a) => a.userId);

  await client.views.open({
    trigger_id: triggerId,
    view: {
      type: "modal",
      callback_id: "edit_assignees",
      private_metadata: JSON.stringify({ caseNumber, oldAssigneeIds: currentIds }),
      title: { type: "plain_text", text: "Edit Assignees" },
      submit: { type: "plain_text", text: "Save" },
      close: { type: "plain_text", text: "Cancel" },
      blocks: [
        {
          type: "input",
          block_id: "assignees",
          optional: true,
          label: { type: "plain_text", text: `Assignees for case #‌${caseNumber}` },
          element: {
            type: "multi_users_select",
            action_id: "assignees_input",
            initial_users: currentIds,
            placeholder: { type: "plain_text", text: "Select assignees" },
          },
          focus_on_load: true,
        },
      ],
    },
  });
}
