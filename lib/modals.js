import {
  getCaseAssignees,
  getCaseByNumber,
  getCaseActions,
  resolveMergeChain,
} from "./case-tracker.js";
import { caseOption } from "./case-options.js";
import { timeAgo } from "./slack-utils.js";

const STATUS_OPTIONS = ["open", "resolved", "canceled", "expired"].map((s) => ({
  text: { type: "plain_text", text: s },
  value: s,
}));

const ACTION_TYPE_LABELS = {
  temp_ban: "Temp Ban",
  perma_ban: "Perma Ban",
  dm: "DM",
  warning: "Warning",
  shush: "Shush",
  locked_thread: "Locked Thread",
};

export function buildCaseInfoView({ caseData, assigneeIds, actions }) {
  const { caseNumber, status, createdAt } = caseData;

  const actionBlocks =
    actions.length === 0
      ? [
          {
            type: "context",
            elements: [{ type: "mrkdwn", text: "_No actions recorded_" }],
          },
        ]
      : actions.map((a) => {
          const label = ACTION_TYPE_LABELS[a.actionType] ?? a.actionType;
          const by = a.performedBy.map((id) => `<@${id}>`).join(", ");
          const when = timeAgo(a.performedAt);
          return {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*${label}* on <@${a.targetUserId}> by ${by} (${when})`,
            },
            accessory: {
              type: "button",
              action_id: "delete_case_action",
              text: { type: "plain_text", text: "Delete" },
              style: "danger",
              value: `${a.id}:${caseNumber}`,
              confirm: {
                title: { type: "plain_text", text: "Delete this action?" },
                text: { type: "mrkdwn", text: "This will permanently remove the action record." },
                confirm: { type: "plain_text", text: "Delete" },
                deny: { type: "plain_text", text: "Cancel" },
                style: "danger",
              },
            },
          };
        });

  return {
    type: "modal",
    callback_id: "case_info",
    private_metadata: JSON.stringify({ caseNumber, oldAssigneeIds: assigneeIds }),
    title: { type: "plain_text", text: `Case #\u200c${caseNumber}` },
    submit: { type: "plain_text", text: "Save" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "context",
        elements: [{ type: "mrkdwn", text: `Created ${timeAgo(createdAt)}` }],
      },
      {
        type: "input",
        block_id: "status",
        label: { type: "plain_text", text: "Status" },
        element: {
          type: "static_select",
          action_id: "status_select",
          options: STATUS_OPTIONS,
          initial_option: STATUS_OPTIONS.find((o) => o.value === status),
        },
      },
      {
        type: "input",
        block_id: "assignees",
        optional: true,
        label: { type: "plain_text", text: "Assignees" },
        element: {
          type: "multi_users_select",
          action_id: "assignees_input",
          initial_users: assigneeIds,
          placeholder: { type: "plain_text", text: "Select assignees" },
        },
      },
      { type: "divider" },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Actions* (${actions.length})`,
        },
      },
      ...actionBlocks,
    ],
  };
}

export async function openCaseInfoModal(client, triggerId, caseNumber) {
  const caseData = await resolveMergeChain(caseNumber);
  if (!caseData) throw new Error(`Case #${caseNumber} not found`);

  const [assignees, actions] = await Promise.all([
    getCaseAssignees(caseData.caseNumber),
    getCaseActions(caseData.caseNumber),
  ]);

  await client.views.open({
    trigger_id: triggerId,
    view: buildCaseInfoView({
      caseData,
      assigneeIds: assignees.map((a) => a.userId),
      actions,
    }),
  });
}

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
          label: { type: "plain_text", text: `Assignees for case #\u200c${caseNumber}` },
          element: {
            type: "multi_users_select",
            action_id: "assignees_input",
            initial_users: currentIds,
            placeholder: { type: "plain_text", text: "Select assignees" },
          },
        },
      ],
    },
  });
}
