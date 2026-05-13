const { buildConductModalBlocks } = require("../lib/blocks");

function register(app) {
  app.action("open_conduct_modal", async ({ ack, body, client }) => {
    await ack();
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

module.exports = register;
