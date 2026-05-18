import { NOTIF_CHANNEL, isDev, isDemoMode } from "../lib/config.js";
import { userClient, base } from "../lib/clients.js";
import { getCaseByThread, resolveCase, recordAction } from "../lib/case-tracker.js";
import { requestUpdate, requestReposition } from "../jobs/sticky-pending.js";
import { isAuthorized, UNAUTHORIZED_TEXT } from "../lib/auth.js";
import { escapeMrkdwn } from "../lib/slack-utils.js";

function register(app) {
  app.view("conduct_report", async ({ ack, view, body, client }) => {
    const values = view.state.values;
    const { channel, thread_ts, permalink } = JSON.parse(view.private_metadata);

    const selectedUsers = values.reported_users.users_select.selected_users || [];
    const bannedUserIds = values.banned_user_ids.banned_ids_input.value
      ? values.banned_user_ids.banned_ids_input.value.split(",").map((id) => id.trim())
      : [];
    const allUserIds = [...selectedUsers, ...bannedUserIds].filter(Boolean);

    const dropdownSolutions =
      values.solution_deets?.solution_select?.selected_options?.map((opt) => opt.value) || [];
    const rawCustomSolution = values.custom_solution?.solution_custom_input?.value?.trim() || "";
    const customSolution = isDemoMode ? escapeMrkdwn(rawCustomSolution) : rawCustomSolution;
    const finalSolution = [dropdownSolutions.join(", "), customSolution].filter(Boolean).join(", ");

    if (!(await isAuthorized(body.user.id, client))) {
      await ack({ response_action: "errors", errors: { reported_users: UNAUTHORIZED_TEXT } });
      return;
    }

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
      const rawResolvers = values.resolved_by.resolver_select.selected_users;
      const resolvers = isDemoMode
        ? [body.user.id, ...rawResolvers.filter((id) => id !== body.user.id)]
        : rawResolvers;
      const rawViolation = values.violation_deets.violation_deets_input.value;
      const violation = isDemoMode ? escapeMrkdwn(rawViolation) : rawViolation;

      // Resolve the case so the sticky drops it.
      const caseData = await getCaseByThread(channel, thread_ts);
      if (caseData) {
        await resolveCase(caseData.caseNumber, body.user.id, "resolved");
        requestUpdate();
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

        if (base) {
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

        if (caseData) {
          await recordAction(caseData.caseNumber, finalSolution, userId, resolvers, {
            whatTheyDid: violation,
            displayName,
            email,
            banUntil: banDate || null,
            permalink,
          });
        }
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
          if (isDev) requestReposition();
        }
      }
    } catch (error) {
      console.error(error);
    }
  });
}

export default register;
