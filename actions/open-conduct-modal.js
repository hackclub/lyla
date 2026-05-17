import { buildConductModalBlocks } from "../lib/blocks.js";
import { isAuthorized, UNAUTHORIZED_TEXT } from "../lib/auth.js";

function register(app) {
  app.action("open_conduct_modal", async ({ ack, body, client }) => {
    await ack();
    if (!await isAuthorized(body.user.id, client)) {
      await client.chat
        .postEphemeral({ channel: body.channel.id, user: body.user.id, text: UNAUTHORIZED_TEXT })
        .catch(() => {});
      return;
    }
    const permalinkResponse = await client.chat.getPermalink({
      channel: body.channel.id,
      message_ts: body.message.thread_ts || body.message.ts,
    });

    const blocks = buildConductModalBlocks(body.user.id);

    await client.views.open({
      trigger_id: body.trigger_id,
      view: {
        type: "modal",
        callback_id: "conduct_report",
        private_metadata: JSON.stringify({
          channel: body.channel.id,
          thread_ts: body.message.thread_ts || body.message.ts,
          permalink: permalinkResponse.permalink,
        }),
        title: { type: "plain_text", text: "FD Record Keeping" },
        blocks,
        submit: { type: "plain_text", text: "Submit" },
      },
    });
  });
}

export default register;
