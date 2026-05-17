import { openMergeModal } from "../lib/modals.js";

function register(app) {
  app.command(/^\/(.*dev-)?lyla-merge$/, async ({ command, ack, client }) => {
    await ack();
    await openMergeModal(client, command.trigger_id);
  });
}

export default register;
