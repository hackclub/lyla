import { assignCase, getCaseAssignees } from "../lib/case-tracker.js";
import { requestUpdate } from "../jobs/sticky-pending.js";

function register(app) {
  app.action("thread_action", async ({ ack, body, action, client }) => {
    await ack();

    const value = action.selected_option?.value ?? "";
    if (!value.startsWith("claim:")) return;

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
      await client.chat.postEphemeral({
        channel: body.channel.id,
        user: userId,
        text: `Case #\u200c${caseNumber} has already been claimed by ${names}.`,
      });
      return;
    }

    requestUpdate();
  });
}

export default register;
