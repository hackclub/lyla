const { NOTIF_CHANNEL } = require("../lib/config");
const { userClient, base } = require("../lib/clients");
const { threadTracker, makeThreadKey } = require("../lib/thread-tracker");

function register(app) {
  app.view("conduct_report", async ({ ack, view, client }) => {
    await ack();
    try {
      const values = view.state.values;
      const { channel, thread_ts, permalink } = JSON.parse(view.private_metadata);

      const selectedUsers = values.reported_users.users_select.selected_users || [];
      const bannedUserIds = values.banned_user_ids.banned_ids_input.value
        ? values.banned_user_ids.banned_ids_input.value.split(",").map((id) => id.trim())
        : [];

      const allUserIds = [...selectedUsers, ...bannedUserIds];
      const banDate = values.ban_until.ban_date_input.selected_date;

      const dropdwnsolutions =
        values.solution_deets?.solution_select?.selected_options?.map((opt) => opt.value) || [];
      const customsolution = values.custom_solution?.solution_custom_input?.value;
      const finalsolution = customsolution
        ? customsolution
        : dropdwnsolutions.length > 0
          ? dropdwnsolutions.join(", ")
          : "";

      const reportedUserName = values.reported_user_name?.reported_user_name_input?.value || "";
      const targetedUser = await userClient.users.info({ user: allUserIds[0] });
      const reportedUserEmail = targetedUser.user?.profile?.email || "";

      if (allUserIds.length === 0) {
        throw new Error("Select users or enter their user IDs");
      }

      if (!finalsolution || finalsolution.trim() === "") {
        throw new Error("Uhm you need to tell us how this was dealt with :P");
      }

      const threadKey = makeThreadKey(channel, thread_ts);
      if (threadTracker.has(threadKey)) {
        const threadData = threadTracker.get(threadKey);
        threadData.report_filed = true;

        try {
          const repliesResp = await client.conversations.replies({
            channel: threadData.channel,
            ts: threadData.thread_ts,
            limit: 1,
            inclusive: true,
          });
          const rootMsg = repliesResp.messages && repliesResp.messages[0];

          if (rootMsg && rootMsg.reactions) {
            const reactions = rootMsg.reactions.map((r) => r.name);
            if (reactions.includes("bangbang")) {
              await client.reactions.remove({
                channel,
                timestamp: threadData.thread_ts,
                name: "bangbang",
              });
            }
          }
        } catch (error) {
          console.error(error);
        }
      }

      for (const userId of allUserIds) {
        let displayName = "Unknown (Banned User)";

        const userProfile = await client.users.profile.get({ user: userId });
        displayName = userProfile.profile.display_name || userProfile.profile.real_name;

        await base("LYLA Records").create([
          {
            fields: {
              "Time Of Report": new Date().toISOString(),
              "Dealt With By": values.resolved_by.resolver_select.selected_users.join(", "),
              "User Being Dealt With": userId,
              "Display Name": displayName,
              "What Did User Do": values.violation_deets.violation_deets_input.value,
              "How Was This Resolved": finalsolution,
              "If Banned, Until When": banDate || null,
              "Link To Message": permalink,
              // "Name": reportedUserName,
              Email: reportedUserEmail,
            },
          },
        ]);
      }

      const reportFields = [
        `*Reported Users:*\n${allUserIds.map((id) => `<@${id.replace(/[<@>]/g, "")}>`).join(", ")}`,
        // `*Reported User's Name:*\n${reportedUserName || "N/A"}`,
        `*Reported User's Email:*\n${reportedUserEmail || "N/A"}`,
        `*Resolved By:*\n${values.resolved_by.resolver_select.selected_users
          .map((user) => `<@${user}>`)
          .join(", ")}`,
        `*What Did They Do?*\n${values.violation_deets.violation_deets_input.value}`,
        `*How Did We Deal With This?*\n${finalsolution}`,
        `*If Banned or Shushed, Until:*\n${
          values.ban_until.ban_date_input.selected_date
            ? new Date(values.ban_until.ban_date_input.selected_date).toLocaleDateString("en-GB", {
                day: "numeric",
                month: "short",
                year: "numeric",
              })
            : "N/A"
        }`,
        `*Link To Message:*\n${permalink}`,
      ];

      await client.chat.postMessage({
        channel,
        thread_ts,
        text: "Conduct Report Filed :yay:",
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text: "*Thanks for filling this <3*" },
          },
          {
            type: "section",
            fields: reportFields.map((text) => ({ type: "mrkdwn", text })),
          },
        ],
      });
      if (banDate || finalsolution.toLowerCase().includes("perma")) {
        const solution = finalsolution.toLowerCase().replace(/[\s\-_]/g, "");
        const excludeChannel = solution.includes("channelban") || solution.includes("channelshush");

        if (!excludeChannel) {
          const userMention = allUserIds.map((id) => `<@${id.replace(/[<@>]/g, "")}>`).join(", ");

          let notifmsg;
          if (finalsolution.toLowerCase().includes("perma")) {
            notifmsg = `${userMention} has been permanently banned... be good kids ^^`;
          } else {
            const dateFormat = new Date(banDate).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
              year: "numeric",
            });
            const action = finalsolution.toLowerCase().includes("shush") ? "shushed" : "banned";
            notifmsg = `${userMention} has been ${action} until ${dateFormat}... be good kids ^^`;
          }

          await client.chat.postMessage({
            channel: NOTIF_CHANNEL,
            text: notifmsg,
          });
        }
      }
    } catch (error) {
      console.error(error);
    }
  });
}

module.exports = register;
