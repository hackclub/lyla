import { FIREHOUSE_CHANNEL } from "../lib/config.js";
import { botClient, base } from "../lib/clients.js";

function formatChannelMention(channelValue) {
  if (!channelValue) return "unknown channel";
  const id = String(channelValue).trim();
  if (/^[CG][A-Z0-9]+$/i.test(id)) return `<#${id}>`;
  return id.startsWith("#") ? id : `#${id}`;
}

async function checkBansForToday() {
  if (!base) return;
  const records = await base("LYLA Records")
    .select({
      filterByFormula: `AND(
        NOT({If Banned, Until When} = BLANK()),
        IS_SAME({If Banned, Until When}, TODAY(), 'day')
      )`,
    })
    .all();

  if (records.length === 0) return;

  for (const record of records) {
    const userId = record.fields["User Being Dealt With"];
    const banEndDate = new Date(record.fields["If Banned, Until When"]).toLocaleDateString(
      "en-GB",
      {
        day: "numeric",
        month: "short",
        year: "numeric",
      }
    );
    const channelBanChannel = record.fields.channel_ban_channel;

    const text = channelBanChannel
      ? `<@${userId}> channel ban in ${formatChannelMention(channelBanChannel)} ends today, react ✅ if unbanned :)`
      : `<@${userId}>'s ban/shush ends today (${banEndDate}), react ✅ if unbanned :)`;

    await botClient.chat
      .postMessage({
        channel: FIREHOUSE_CHANNEL,
        text,
      })
      .catch((e) => console.error("Could not post unban reminder:", e.message));
  }
}

export default checkBansForToday;
