import {
  getCaseAssignees,
  getCaseByNumber,
  getCaseActions,
  getCaseActionsByUser,
  getPrimaryThreadsForCases,
  resolveMergeChain,
} from "./case-tracker.js";
import { caseOption } from "./case-options.js";
import {
  timeAgo,
  truncateToWordBoundary,
  escapeMrkdwn,
  threadUrl,
  formatActor,
} from "./slack-utils.js";
import { getUserNotes, getUserNotesPage } from "./user-notes.js";
import { getAuditTrailForUser } from "./audit-log.js";
import { getActiveCategories } from "./infraction-categories.js";

const STATUS_OPTIONS = ["open", "resolved", "canceled", "expired"].map((s) => ({
  text: { type: "plain_text", text: s },
  value: s,
}));

export const INFO_PAGE_SIZE = 3;

const ACTION_TYPE_LABELS = {
  temp_ban: "Temp Ban",
  indef_ban: "Indef Ban",
  perma_ban: "Perma Ban",
  dm: "DM",
  warning: "Warning",
  shush: "Shush",
  channel_ban: "Channel Ban",
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
      : actions.flatMap((a) => {
          const label = ACTION_TYPE_LABELS[a.actionType] ?? a.actionType;
          const by = a.performedBy.map((id) => `<@${id}>`).join(", ");
          const when = timeAgo(a.performedAt);
          return [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `*${label}* on <@${a.targetUserId}> by ${by} (${when})`,
              },
            },
            {
              type: "actions",
              block_id: `action_buttons_${a.id}`,
              elements: [
                {
                  type: "button",
                  action_id: "edit_case_action",
                  text: { type: "plain_text", text: "Edit" },
                  value: `${a.id}:${caseNumber}`,
                },
                {
                  type: "button",
                  action_id: "delete_case_action",
                  text: { type: "plain_text", text: "Delete" },
                  style: "danger",
                  value: `${a.id}:${caseNumber}`,
                  confirm: {
                    title: { type: "plain_text", text: "Delete this action?" },
                    text: {
                      type: "mrkdwn",
                      text: "This will permanently remove the action record.",
                    },
                    confirm: { type: "plain_text", text: "Delete" },
                    deny: { type: "plain_text", text: "Cancel" },
                    style: "danger",
                  },
                },
              ],
            },
          ];
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

export function buildEditCaseActionView({
  action,
  categories,
  caseNumber,
  currentStatus,
  currentAssigneeIds,
}) {
  const categoryOptions = categories.map((c) => ({
    text: { type: "plain_text", text: truncateToWordBoundary(c.name, 72) },
    value: String(c.code),
  }));
  const initialCategoryOption = categoryOptions.find(
    (o) => o.value === String(action.categoryCode)
  );

  return {
    type: "modal",
    callback_id: "edit_case_action",
    private_metadata: JSON.stringify({
      actionId: action.id,
      caseNumber,
      currentStatus,
      currentAssigneeIds,
    }),
    title: { type: "plain_text", text: "Edit Action" },
    submit: { type: "plain_text", text: "Save" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "input",
        block_id: "category",
        optional: true,
        label: { type: "plain_text", text: "Infraction Category" },
        element: {
          type: "static_select",
          action_id: "category_select",
          options: categoryOptions,
          ...(initialCategoryOption ? { initial_option: initialCategoryOption } : {}),
        },
      },
      {
        type: "input",
        block_id: "category_extra",
        optional: true,
        label: { type: "plain_text", text: "Category Extra Info" },
        element: {
          type: "plain_text_input",
          action_id: "category_extra_input",
          ...(action.categoryExtra ? { initial_value: action.categoryExtra } : {}),
        },
      },
      {
        type: "input",
        block_id: "what_they_did",
        optional: true,
        label: { type: "plain_text", text: "What Did They Do?" },
        element: {
          type: "plain_text_input",
          action_id: "what_they_did_input",
          multiline: true,
          ...(action.data?.whatTheyDid ? { initial_value: action.data.whatTheyDid } : {}),
        },
      },
      {
        type: "input",
        block_id: "ban_until",
        optional: true,
        label: { type: "plain_text", text: "If Banned or Shushed, Until When?" },
        element: {
          type: "datepicker",
          action_id: "ban_date_input",
          placeholder: { type: "plain_text", text: "Select a date" },
          ...(action.data?.banUntil ? { initial_date: action.data.banUntil } : {}),
        },
      },
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

export function buildUserNotesView({ targetUserId, notes }) {
  const noteBlocks = notes.flatMap((note) => {
    const authorLine = `by <@${note.createdBy}>, ${timeAgo(note.createdAt)}${
      note.editedBy ? ` (edited by <@${note.editedBy}>, ${timeAgo(note.editedAt)})` : ""
    }`;
    return [
      {
        type: "section",
        text: { type: "mrkdwn", text: `${escapeMrkdwn(note.body)}\n_${authorLine}_` },
      },
      {
        type: "actions",
        block_id: `note_buttons_${note.id}`,
        elements: [
          {
            type: "button",
            action_id: "edit_user_note",
            text: { type: "plain_text", text: "Edit" },
            value: String(note.id),
          },
          {
            type: "button",
            action_id: "delete_user_note",
            text: { type: "plain_text", text: "Delete" },
            style: "danger",
            value: String(note.id),
            confirm: {
              title: { type: "plain_text", text: "Delete this note?" },
              text: { type: "mrkdwn", text: "This will permanently remove the note." },
              confirm: { type: "plain_text", text: "Delete" },
              deny: { type: "plain_text", text: "Cancel" },
              style: "danger",
            },
          },
        ],
      },
    ];
  });

  return {
    type: "modal",
    callback_id: "user_notes",
    private_metadata: JSON.stringify({ targetUserId }),
    title: { type: "plain_text", text: "User Notes" },
    submit: { type: "plain_text", text: "Save" },
    close: { type: "plain_text", text: "Close" },
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: `Notes for <@${targetUserId}>` },
      },
      { type: "divider" },
      ...(noteBlocks.length > 0
        ? noteBlocks
        : [
            {
              type: "context",
              elements: [{ type: "mrkdwn", text: "_No notes yet_" }],
            },
          ]),
      { type: "divider" },
      {
        type: "input",
        block_id: "new_note",
        optional: true,
        label: { type: "plain_text", text: "Add a note" },
        element: {
          type: "plain_text_input",
          action_id: "new_note_input",
          multiline: true,
        },
      },
    ],
  };
}

export async function openUserNotesModal(client, triggerId, targetUserId) {
  const notes = await getUserNotes(targetUserId);
  await client.views.open({
    trigger_id: triggerId,
    view: buildUserNotesView({ targetUserId, notes }),
  });
}

export function buildEditUserNoteView({ note }) {
  return {
    type: "modal",
    callback_id: "edit_user_note",
    private_metadata: JSON.stringify({ noteId: note.id, targetUserId: note.targetUserId }),
    title: { type: "plain_text", text: "Edit Note" },
    submit: { type: "plain_text", text: "Save" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "input",
        block_id: "body",
        label: { type: "plain_text", text: "Note" },
        element: {
          type: "plain_text_input",
          action_id: "body_input",
          multiline: true,
          initial_value: note.body,
        },
      },
    ],
  };
}

function showMoreButton(actionId, currentLimit) {
  return {
    type: "actions",
    block_id: `${actionId}_block`,
    elements: [
      {
        type: "button",
        action_id: actionId,
        text: { type: "plain_text", text: `Show ${INFO_PAGE_SIZE} more` },
        value: String(currentLimit),
      },
    ],
  };
}

export function buildUserInfoView({
  targetUserId,
  actions,
  actionsHasMore,
  actionsLimit,
  notes,
  notesHasMore,
  notesLimit,
  auditTrail,
  auditHasMore,
  auditLimit,
  categoryNameByCode,
  primaryThreadByCase = new Map(),
}) {
  const caseLink = (caseNumber) => {
    const thread = primaryThreadByCase.get(caseNumber);
    return thread
      ? `<${threadUrl(thread.channel, thread.threadTs)}|#\u200c${caseNumber}>`
      : `#\u200c${caseNumber}`;
  };

  const normalizedActions = actions.map((a) => {
    const thread = primaryThreadByCase.get(a.caseNumber);
    return {
      label: ACTION_TYPE_LABELS[a.actionType] ?? a.actionType,
      caseNumber: a.caseNumber,
      performedByIds: a.performedBy,
      when: a.performedAt,
      categoryName: a.categoryCode != null ? categoryNameByCode.get(a.categoryCode) : null,
      threadUrl: thread ? threadUrl(thread.channel, thread.threadTs) : a.data?.permalink || null,
      whatTheyDid: a.data?.whatTheyDid?.trim() || null,
    };
  });
  const combinedActions = normalizedActions;

  const actionBlocks =
    combinedActions.length === 0
      ? [{ type: "context", elements: [{ type: "mrkdwn", text: "_No actions recorded_" }] }]
      : combinedActions.map((entry) => {
          const categorySuffix = entry.categoryName
            ? ` - _${escapeMrkdwn(entry.categoryName)}_`
            : "";
          const by =
            entry.performedByIds.length > 0
              ? entry.performedByIds.map((id) => `<@${id}>`).join(", ")
              : "unknown";
          const when = timeAgo(entry.when);
          const caseSuffix =
            entry.caseNumber == null
              ? ""
              : entry.threadUrl
                ? ` on case <${entry.threadUrl}|#\u200c${entry.caseNumber}>`
                : ` on case #\u200c${entry.caseNumber}`;
          const whatTheyDidLine = entry.whatTheyDid
            ? `\n_"${escapeMrkdwn(entry.whatTheyDid)}"_`
            : "";
          return {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*${entry.label}*${caseSuffix} by ${by} (${when})${categorySuffix}${whatTheyDidLine}`,
            },
            ...(entry.threadUrl
              ? {
                  accessory: {
                    type: "button",
                    action_id: "view_case_thread",
                    text: { type: "plain_text", text: "View Thread" },
                    url: entry.threadUrl,
                  },
                }
              : {}),
          };
        });
  if (actionsHasMore) actionBlocks.push(showMoreButton("show_more_actions", actionsLimit));

  const noteBlocks =
    notes.length === 0
      ? [{ type: "context", elements: [{ type: "mrkdwn", text: "_No notes_" }] }]
      : notes.map((note) => ({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `${escapeMrkdwn(note.body)}\n_by <@${note.createdBy}>, ${timeAgo(note.createdAt)}_`,
          },
        }));
  if (notesHasMore) noteBlocks.push(showMoreButton("show_more_notes", notesLimit));

  const auditBlocks =
    auditTrail.length === 0
      ? [{ type: "context", elements: [{ type: "mrkdwn", text: "_No recorded changes_" }] }]
      : auditTrail.map((entry) => {
          const verb = entry.changeType === "delete" ? "Deleted" : "Edited";
          const subjectLabel = entry.subjectType === "case_action" ? "case action" : "note";
          const caseSuffix =
            entry.caseNumber != null ? ` on case ${caseLink(entry.caseNumber)}` : "";
          return {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: `${verb} ${subjectLabel}${caseSuffix} by ${formatActor(entry.actorId)} (${timeAgo(entry.createdAt)})`,
              },
            ],
          };
        });
  if (auditHasMore) auditBlocks.push(showMoreButton("show_more_audit", auditLimit));

  return {
    type: "modal",
    callback_id: "user_info",
    private_metadata: JSON.stringify({ targetUserId, actionsLimit, notesLimit, auditLimit }),
    title: { type: "plain_text", text: "User Info" },
    close: { type: "plain_text", text: "Close" },
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: `Info for <@${targetUserId}>` },
      },
      { type: "divider" },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Case Actions*${actionsHasMore ? " (more available)" : ""}`,
        },
      },
      ...actionBlocks,
      { type: "divider" },
      {
        type: "section",
        text: { type: "mrkdwn", text: `*Notes*${notesHasMore ? " (more available)" : ""}` },
      },
      ...noteBlocks,
      { type: "divider" },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Recent Changes*${auditHasMore ? " (more available)" : ""}`,
        },
      },
      ...auditBlocks,
    ],
  };
}

export async function assembleUserInfoView(
  targetUserId,
  { actionsLimit = INFO_PAGE_SIZE, notesLimit = INFO_PAGE_SIZE, auditLimit = INFO_PAGE_SIZE } = {}
) {
  const [actionsPage, notesPage, auditPage, categories] = await Promise.all([
    getCaseActionsByUser(targetUserId, actionsLimit),
    getUserNotesPage(targetUserId, notesLimit),
    getAuditTrailForUser(targetUserId, auditLimit),
    getActiveCategories(),
  ]);

  const categoryNameByCode = new Map(categories.map((c) => [c.code, c.name]));

  const caseNumbers = [
    ...new Set(
      [
        ...actionsPage.actions.map((a) => a.caseNumber),
        ...auditPage.entries.map((e) => e.caseNumber),
      ].filter((n) => n != null)
    ),
  ];
  const primaryThreadByCase = await getPrimaryThreadsForCases(caseNumbers);

  return buildUserInfoView({
    targetUserId,
    actions: actionsPage.actions,
    actionsHasMore: actionsPage.hasMore,
    actionsLimit,
    notes: notesPage.notes,
    notesHasMore: notesPage.hasMore,
    notesLimit,
    auditTrail: auditPage.entries,
    auditHasMore: auditPage.hasMore,
    auditLimit,
    categoryNameByCode,
    primaryThreadByCase,
  });
}

export async function openUserInfoModal(client, triggerId, targetUserId) {
  const view = await assembleUserInfoView(targetUserId);
  await client.views.open({ trigger_id: triggerId, view });
}
