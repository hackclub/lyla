const { NOTIF_CHANNEL } = require("../lib/config");
const { userClient, base } = require("../lib/clients");
const { threadTracker, makeThreadKey } = require("../lib/thread-tracker");
const { requestRefresh } = require("../jobs/sticky-pending");

function register(app) {
  app.view("conduct_report", async ({ ack, view, client }) => {
    const values = view.state.values;
    const { channel, thread_ts, permalink } = JSON.parse(view.private_metadata);

    const selectedUsers = values.reported_users.users_select.selected_users || [];
    const bannedUserIds = values.banned_user_ids.banned_ids_input.value
      ? values.banned_user_ids.banned_ids_input.value.split(",").map((id) => id.trim())
      : [];
    const allUserIds = [...selectedUsers, ...bannedUserIds].filter(Boolean);

    const dropdownSolutions =
      values.solution_deets?.solution_select?.selected_options?.map((opt) => opt.value) || [];
    const customSolution = values.custom_solution?.solution_custom_input?.value?.trim() || "";
    const finalSolution = [dropdownSolutions.join(", "), customSolution].filter(Boolean).join(", ");

    // Inline validation: tell Slack to show errors in the modal.
    const errors = {};
    if (allUserIds.length === 0) {
      errors.reported_users = "Select users or enter their user IDs below.";
    }
    if (!finalSolution) {
      errors.solution_deets = "Pick a solution above or describe one below.";
    }
    if (Object.keys(errors).length > 0) {
      return await ack({ response_action: "errors", errors });
    }

    await ack();

    try {
      const banDate = values.ban_until.ban_date_input.selected_date;
      const resolvers = values.resolved_by.resolver_select.selected_users;
      const violation = values.violation_deets.violation_deets_input.value;

      // Mark thread as resolved so the sticky drops it.
      const threadKey = makeThreadKey(channel, thread_ts);
      if (threadTracker.has(threadKey)) {
        threadTracker.get(threadKey).report_filed = true;
        requestRefresh(client);
      }

      // Look up display name + email for each reported user, then write
      // one Airtable record per user with that user's own email.
      const userInfo = new Map();
      for (const userId of allUserIds) {
        let displayName = "Unknown (Banned User)";
        let email = "";

        try {
          const profile = await client.users.profile.get({ user: userId });
          displayName = profile.profile.display_name || profile.profile.real_name;
        } catch (error) {
          console.error(`Could not fetch profile for ${userId}:`, error.message);
        }

        try {
          const info = await userClient.users.info({ user: userId });
          email = info.user?.profile?.email || "";
        } catch (error) {
          console.error(`Could not fetch email for ${userId}:`, error.message);
        }

        userInfo.set(userId, { displayName, email });

        await base("LYLA Records").create([
          {
            fields: {
              "Time Of Report": new Date().toISOString(),
              "Dealt With By": resolvers.join(", "),
              "User Being Dealt With": userId,
              "Display Name": displayName,
              "What Did User Do": violation,
              "How Was This Resolved": finalSolution,
              "If Banned, Until When": banDate || null,
              "Link To Message": permalink,
              Email: email,
            },
          },
        ]);
      }

      const emailLines = allUserIds
        .map((id) => {
          const { email } = userInfo.get(id);
          return `<@${id.replace(/[<@>]/g, "")}>: ${email || "N/A"}`;
        })
        .join("\n");

      const reportFields = [
        `*Reported Users:*\n${allUserIds.map((id) => `<@${id.replace(/[<@>]/g, "")}>`).join(", ")}`,
        `*Reported User Emails:*\n${emailLines}`,
        `*Resolved By:*\n${resolvers.map((user) => `<@${user}>`).join(", ")}`,
        `*What Did They Do?*\n${violation}`,
        `*How Did We Deal With This?*\n${finalSolution}`,
        `*If Banned or Shushed, Until:*\n${
          banDate
            ? new Date(banDate).toLocaleDateString("en-GB", {
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

      if (banDate || finalSolution.toLowerCase().includes("perma")) {
        const solution = finalSolution.toLowerCase().replace(/[\s\-_]/g, "");
        const excludeChannel = solution.includes("channelban") || solution.includes("channelshush");

        if (!excludeChannel) {
          const userMention = allUserIds.map((id) => `<@${id.replace(/[<@>]/g, "")}>`).join(", ");

          let notifmsg;
          if (finalSolution.toLowerCase().includes("perma")) {
            notifmsg = `${userMention} has been permanently banned... be good kids ^^`;
          } else {
            const dateFormat = new Date(banDate).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
              year: "numeric",
            });
            const action = finalSolution.toLowerCase().includes("shush") ? "shushed" : "banned";
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
