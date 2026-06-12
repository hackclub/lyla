import { FIREHOUSE_CHANNEL } from "../lib/config.js";
import { botClient, base } from "../lib/clients.js";

async function checkBansForToday() {
  if (!base) return;
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

    await botClient.chat
      .postMessage({
        channel: FIREHOUSE_CHANNEL,
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
      })
      .catch((e) => console.error("Could not post unban reminder:", e.message));
  }
}

export default checkBansForToday;
