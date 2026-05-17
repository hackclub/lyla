import { getCaseAssignees } from "./case-tracker.js";
import { caseOption } from "./case-options.js";

export async function openMergeModal(client, triggerId, prefillCaseNumber = null) {
  const prefillOption = prefillCaseNumber != null ? await caseOption(prefillCaseNumber) : null;

  const caseSelectElement = (initial) => ({
    type: "external_select",
    action_id: "case_select",
    placeholder: { type: "plain_text", text: "Type a case number..." },
    min_query_length: 0,
    ...(initial ? { initial_option: initial } : {}),
  });

  await client.views.open({
    trigger_id: triggerId,
    view: {
      type: "modal",
      callback_id: "merge_cases",
      title: { type: "plain_text", text: "Merge Cases" },
      submit: { type: "plain_text", text: "Merge" },
      close: { type: "plain_text", text: "Cancel" },
      blocks: [
        {
          type: "input",
          block_id: "from_case",
          label: { type: "plain_text", text: "Duplicate case" },
          element: caseSelectElement(prefillOption),
        },
        {
          type: "context",
          elements: [{ type: "mrkdwn", text: "↓ will be merged into" }],
        },
        {
          type: "input",
          block_id: "to_case",
          label: { type: "plain_text", text: "Main case" },
          element: caseSelectElement(null),
        },
      ],
    },
  });
}

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
