import { ALLOWED_CHANNELS } from "../lib/config.js";
import { userClient, base } from "../lib/clients.js";
import { isAuthorized, UNAUTHORIZED_TEXT } from "../lib/auth.js";

function register(app) {
  app.command(/^\/(.*dev-)?prevreports$/, async ({ command, ack, client, respond }) => {
    await ack();
    if (!(await isAuthorized(command.user_id, client))) {
      await respond({ text: UNAUTHORIZED_TEXT, response_type: "ephemeral" });
      return;
    }
    try {
      if (!ALLOWED_CHANNELS.includes(command.channel_id)) {
        respond({
          text: `You are not in the correct channel for this :P`,
          response_type: "ephemeral",
        });
        return;
      }
      const [userId, source] = command.text.trim().split(" ");
      if (!userId || !source) {
        return await respond({
          text: "Use the format: `/prevreports @user|email slack|airtable`",
          response_type: "ephemeral",
        });
      }
      const isEmail = userId.includes("@") && !userId.startsWith("<@");
      const cleanUserId = isEmail
        ? userId.replace(/^<mailto:([^|]+)\|.*>$/, "$1")
        : userId.startsWith("<@")
          ? userId.slice(2, -1).split("|")[0]
          : userId.replace(/[<@>]/g, "");
      if (source.toLowerCase() === "slack") {
        if (isEmail) {
          return await respond({
            text: "Email lookup is only supported with `airtable`, not `slack`.",
            response_type: "ephemeral",
          });
        }
        const msgSearch = await userClient.search.messages({
          query: `in:#hq-firehouse <@${cleanUserId}>`,
          count: 100,
          sort: "timestamp",
          sort_dir: "asc",
        });
        let allMessages = [...msgSearch.messages.matches];
        allMessages = allMessages.filter((match) => {
          const mentionsUser = match.text.includes(`<@${cleanUserId}>`);
          const isThreadMessage = match.thread_ts && match.thread_ts !== match.ts;
          return mentionsUser || !isThreadMessage;
        });
        allMessages.sort((a, b) => parseFloat(b.ts) - parseFloat(a.ts));
        const filteredMessages = allMessages
          .filter((match) => ALLOWED_CHANNELS.includes(match.channel.id))
          .slice(0, 20);
        if (!filteredMessages.length) {
          return await respond({
            text: `No previous messages mentioning ${userId} found in Slack :)`,
            response_type: "ephemeral",
          });
        }
        const messageBlocks = filteredMessages.map((match) => {
          const messageDate = new Date(parseFloat(match.ts) * 1000);
          const formattedDate = messageDate.toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
            year: "numeric",
          });
          const formattedTime = messageDate.toLocaleString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: true,
          });
          const timestamp = `${formattedDate} at ${formattedTime}`;
          const shortenedText =
            match.text.length > 200 ? match.text.substring(0, 200) + "..." : match.text;
          return {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*Message from: ${timestamp}*\n${shortenedText}\n<${match.permalink}|View full message>`,
            },
          };
        });
        await respond({
          text: `Most recent Slack messages mentioning ${userId}`,
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `Most recent Slack messages mentioning ${userId}:`,
              },
            },
            ...messageBlocks,
          ],
          response_type: "ephemeral",
          unfurl_links: false,
          unfurl_media: false,
        });
      } else if (source.toLowerCase() === "airtable") {
        const filterFormula = isEmail
          ? `{Email} = '${cleanUserId}'`
          : `{User Being Dealt With} = '${cleanUserId}'`;
        const records = await base("LYLA Records")
          .select({
            filterByFormula: filterFormula,
            sort: [{ field: "Time Of Report", direction: "desc" }],
          })
          .all();

        if (!records.length) {
          return await respond({
            text: `No previous reports found in the Airtable Base for ${userId} :(`,
            response_type: "ephemeral",
          });
        }

        const formatUserMentions = (userIds) => {
          if (!userIds) return "";
          return userIds
            .split(",")
            .map((id) => id.trim())
            .map((id) => `<@${id.replace(/[<@>]/g, "")}>`)
            .join(", ");
        };

        const reportEntries = records.map((record) => {
          const fields = record.fields;
          const date = new Date(fields["Time Of Report"]).toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
            year: "numeric",
          });
          const dealtWithBy = formatUserMentions(fields["Dealt With By"]);
          let reportText = `*Report from ${date}*
*Dealt With By:* ${dealtWithBy}
*What Did User Do:* ${fields["What Did User Do"]}
*How Was This Resolved:* ${fields["How Was This Resolved"]}
<${fields["Link To Message"]}|View Message>`;

          return reportText;
        });

        const messageText = `Airtable records for ${userId}:\n\n${reportEntries.join("\n\n")}`;

        await respond({
          text: messageText,
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: messageText.substring(0, 2900),
              },
            },
          ],
          response_type: "ephemeral",
          unfurl_links: false,
          unfurl_media: false,
        });
      } else {
        return await respond({
          text: "Erm you need to specify 'slack' or 'airtable'",
          response_type: "ephemeral",
        });
      }
    } catch (error) {
      console.error(error);
      await respond({
        text: `An error occurred: ${error.message}`,
        response_type: "ephemeral",
      });
    }
  });
}

export default register;
