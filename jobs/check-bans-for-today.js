const { ALLOWED_CHANNELS } = require("../lib/config");
const { base } = require("../lib/clients");

async function checkBansForToday(client) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const records = await base("LYLA Records")
    .select({
      filterByFormula: `AND(
        NOT({If Banned, Until When} = BLANK()),
        IS_SAME({If Banned, Until When}, TODAY(), 'day')
      )`,
    })
    .all();

  if (records.length > 0) {
    const banMessages = records.map((record) => {
      const userId = record.fields["User Being Dealt With"];
      const banEndDate = new Date(record.fields["If Banned, Until When"]).toLocaleDateString(
        "en-GB",
        {
          day: "numeric",
          month: "short",
          year: "numeric",
        }
      );
      return `<@${userId}>'s ban/shush ends today (${banEndDate}), react ✅ if unbanned :)`;
    });

    await client.chat.postMessage({
      channel: ALLOWED_CHANNELS[0],
      text: "Unban awaiting!!",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: banMessages.join("\n\n"),
          },
        },
      ],
    });
  }
}

module.exports = checkBansForToday;
