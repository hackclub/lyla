import { openMergeModal } from "../lib/modals.js";
import { isAuthorized, UNAUTHORIZED_TEXT } from "../lib/auth.js";

function register(app) {
  app.command(/^\/(.*dev-)?lyla-merge$/, async ({ command, ack, client, respond }) => {
    await ack();
    if (!await isAuthorized(command.user_id, client)) {
      await respond({ text: UNAUTHORIZED_TEXT, response_type: "ephemeral" });
      return;
    }
    await openMergeModal(client, command.trigger_id);
  });
}

export default register;
