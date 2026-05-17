import { assignCase, getCaseAssignees, getCasePrimaryThread } from "../lib/case-tracker.js";
import { openEditAssigneesModal, openMergeModal } from "../lib/modals.js";
import { requestUpdate } from "../jobs/sticky-pending.js";
import { isAuthorized, UNAUTHORIZED_TEXT } from "../lib/auth.js";

function register(app) {
  app.action("thread_action", async ({ ack, body, action, client }) => {
    await ack();

    if (!await isAuthorized(body.user.id, client)) {
      await client.chat
        .postEphemeral({ channel: body.channel.id, user: body.user.id, text: UNAUTHORIZED_TEXT })
        .catch(() => {});
      return;
    }

    const value = action.selected_option?.value ?? "";

    if (value.startsWith("claim:")) {
      const caseNumber = parseInt(value.slice("claim:".length), 10);
      if (isNaN(caseNumber)) return;

      const userId = body.user.id;
      const claimed = await assignCase(caseNumber, userId, "self");

      if (!claimed) {
        const assignees = await getCaseAssignees(caseNumber);
        const assigneeNames = await Promise.all(
          assignees.map(async (a) => {
            try {
              const resp = await client.users.info({ user: a.userId });
              return resp.user?.profile?.display_name || resp.user?.profile?.real_name || a.userId;
            } catch {
              return a.userId;
            }
          })
        );
        const names = assigneeNames.length > 0 ? assigneeNames.join(", ") : "someone";
        await client.chat
          .postEphemeral({
            channel: body.channel.id,
            user: userId,
            text: `Case #\u200c${caseNumber} has already been claimed by ${names}`,
          })
          .catch(() => {});
        return;
      }

      const thread = await getCasePrimaryThread(caseNumber);
      if (thread) {
        await client.chat
          .postMessage({
            channel: thread.channel,
            thread_ts: thread.threadTs,
            text: `<@${userId}> claimed this case (#\u200c${caseNumber})`,
          })
          .catch(() => {});
      }

      requestUpdate();
      return;
    }

    if (value.startsWith("edit_assignees:")) {
      const caseNumber = parseInt(value.slice("edit_assignees:".length), 10);
      if (isNaN(caseNumber)) return;
      await openEditAssigneesModal(client, body.trigger_id, caseNumber);
      return;
    }

    if (value.startsWith("merge:")) {
      const caseNumber = parseInt(value.slice("merge:".length), 10);
      if (isNaN(caseNumber)) return;
      await openMergeModal(client, body.trigger_id, caseNumber);
    }
  });
}

export default register;
