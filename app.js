const { App } = require("@slack/bolt");
const { WebClient } = require("@slack/web-api");
const Airtable = require("airtable");
const schedule = require("node-schedule");

try {
  process.loadEnvFile();
} catch (e) {
  console.log("No .env file found, proceeding with existing environment variables");  
}

const isDev = process.env.NODE_ENV === "development";
const devChannel = process.env.DEV_CHANNEL;

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: isDev,
  port: process.env.PORT || 3000,
});

const userClient = new WebClient(process.env.SLACK_USER_TOKEN);
const ALLOWED_CHANNELS = isDev
  ? [devChannel]
  : ["G01DBHPLK25", "C07FL3G62LF", "C07UBURESHZ"];
const NOTIF_CHANNEL = isDev ? devChannel : "C085UEFDW6R";
const base = new Airtable({ apiKey: process.env.AIRTABLE_PAT }).base(
  process.env.AIRTABLE_BASE_ID
);
const threadTracker = new Map();

app.event("reaction_added", async ({ event, client }) => {
  const hourglassEmojis = [
    "hourglass",
    "hourglass_flowing_sand",
    "hourglass_not_done",
  ];

  if (
    ALLOWED_CHANNELS.includes(event.item.channel) &&
    hourglassEmojis.includes(event.reaction)
  ) {
    const threadKey = `${event.item.channel}-${event.item.ts}`;
    if (!threadTracker.has(threadKey)) {
      threadTracker.set(threadKey, {
        channel: event.item.channel,
        thread_ts: event.item.ts,
        ban_reaction_time: Date.now(),
        conduct_prompt_sent: false,
        pending_message_sent: false,
        pending_message_ts: null,
        last_pending_msg_time: null,
        report_filed: false,
      });
    }
  }

  if (
    ALLOWED_CHANNELS.includes(event.item.channel) &&
    event.reaction === "ban"
  ) {
    const threadKey = `${event.item.channel}-${event.item.ts}`;
    if (!threadTracker.has(threadKey)) {
      threadTracker.set(threadKey, {
        channel: event.item.channel,
        thread_ts: event.item.ts,
        ban_reaction_time: Date.now(),
        conduct_prompt_sent: false,
        pending_message_sent: false,
        pending_message_ts: null,
        last_pending_msg_time: null,
        report_filed: false,
      });
    }

    const threadData = threadTracker.get(threadKey);
    threadData.conduct_prompt_sent = true;
    threadData.last_prompt_time = Date.now();

    await client.chat.postMessage({
      channel: event.item.channel,
      thread_ts: event.item.ts,
      text: "Wanna file a conduct report?",
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: "*Wanna file a conduct report?*" },
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: {
                type: "plain_text",
                text: "File A Report Here",
                emoji: true,
              },
              action_id: "open_conduct_modal",
              style: "primary",
            },
          ],
        },
      ],
    });
    return;
  }

  if (
    event.reaction === "bangbang" &&
    ALLOWED_CHANNELS.includes(event.item.channel)
  ) {
    try {
      const messageResp = await client.conversations.history({
        channel: event.item.channel,
        latest: event.item.ts,
        limit: 1,
        inclusive: true,
      });

      if (!messageResp.messages || messageResp.messages.length === 0) {
        return;
      }

      const message = messageResp.messages[0];
      const threadTs = message.thread_ts ? message.thread_ts : message.ts; // Use full ts values

      const repliesResp = await client.conversations.replies({
        channel: event.item.channel,
        ts: threadTs,
        limit: 2,
        inclusive: true,
      });

      if (repliesResp.messages && repliesResp.messages.length === 1) {
        await client.chat.postMessage({
          channel: event.item.channel,
          text: "This thread needs attention!",
          thread_ts: threadTs,
          reply_broadcast: true,
        });
      } else {
      }
    } catch (error) {
      console.error("Error:", error);
    }
    return;
  }

  if (
    !ALLOWED_CHANNELS.includes(event.item.channel) ||
    event.reaction !== "ban"
  )
    return;

  const threadKey = `${event.item.channel}-${event.item.ts}`;
  if (!threadTracker.has(threadKey)) {
    threadTracker.set(threadKey, {
      channel: event.item.channel,
      thread_ts: event.item.ts,
      ban_reaction_time: Date.now(),
      conduct_prompt_sent: false,
      pending_message_sent: false,
      pending_message_ts: null,
      last_pending_msg_time: null,
      report_filed: false,
    });
  }

  const threadData = threadTracker.get(threadKey);
  threadData.conduct_prompt_sent = true;
  threadData.last_prompt_time = Date.now();

  await client.chat.postMessage({
    channel: event.item.channel,
    thread_ts: event.item.ts,
    text: "Wanna file a conduct report?",
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: "*Wanna file a conduct report?*" },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: {
              type: "plain_text",
              text: "File A Report Here",
              emoji: true,
            },
            action_id: "open_conduct_modal",
            style: "primary",
          },
        ],
      },
    ],
  });
});

const modalBlocks = [
  {
    type: "input",
    block_id: "reported_users",
    label: { type: "plain_text", text: "User(s) Being Reported?" },
    element: {
      type: "multi_users_select",
      action_id: "users_select",
    },
    optional: true,
  },
  {
    type: "input",
    block_id: "banned_user_ids",
    label: {
      type: "plain_text",
      text: "User ID - Separate multiple with commas",
    },
    element: {
      type: "plain_text_input",
      action_id: "banned_ids_input",
    },
    optional: true,
  },
  {
    type: "input",
    block_id: "violation_deets",
    label: { type: "plain_text", text: "What Did They Do?" },
    element: {
      type: "plain_text_input",
      action_id: "violation_deets_input",
      multiline: true,
    },
  },
  {
    type: "input",
    block_id: "solution_deets",
    label: { type: "plain_text", text: "How Was This Solved?" },
    element: {
      type: "multi_static_select",
      action_id: "solution_select",
      placeholder: { type: "plain_text", text: "Select options" },
      options: [
        { text: { type: "plain_text", text: "Temp Ban" }, value: "Temp Ban" },
        { text: { type: "plain_text", text: "Perma Ban" }, value: "Perma Ban" },
        { text: { type: "plain_text", text: "DM" }, value: "DM" },
        { text: { type: "plain_text", text: "Warning" }, value: "Warning" },
        { text: { type: "plain_text", text: "Shush" }, value: "Shush" },
        {
          text: { type: "plain_text", text: "Locked Thread" },
          value: "Locked Thread",
        },
      ],
    },
    optional: true,
  },

  {
    type: "input",
    block_id: "custom_solution",
    label: { type: "plain_text", text: "How Was This Solved? (Text edition)" },
    element: {
      type: "plain_text_input",
      action_id: "solution_custom_input",
      multiline: true,
    },
    optional: true,
  },
  {
    type: "input",
    block_id: "ban_until",
    label: { type: "plain_text", text: "If Banned or Shushed, Until When?" },
    element: {
      type: "datepicker",
      action_id: "ban_date_input",
      placeholder: { type: "plain_text", text: "Select a date" },
    },
    optional: true,
  },
  {
    type: "input",
    block_id: "reported_user_name",
    label: { type: "plain_text", text: "Reported User's Name" },
    element: {
      type: "plain_text_input",
      action_id: "reported_user_name_input",
    },
    optional: true,
  },
  {
    type: "input",
    block_id: "resolved_by",
    label: {
      type: "plain_text",
      text: "Who Resolved This? (Thank you btw <3)",
    },
    element: {
      type: "multi_users_select",
      action_id: "resolver_select",
      initial_users: ["{{user_id}}"],
    },
  },
];

app.action("open_conduct_modal", async ({ ack, body, client }) => {
  await ack();
  const permalinkResponse = await client.chat.getPermalink({
    channel: body.channel.id,
    message_ts: body.message.thread_ts || body.message.ts,
  });

  const modalBlocksWithUser = JSON.parse(JSON.stringify(modalBlocks));
  const resolverBlock = modalBlocksWithUser.find(
    (block) => block.block_id === "resolved_by"
  );
  resolverBlock.element.initial_users = [body.user.id];

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
      blocks: modalBlocksWithUser,
      submit: { type: "plain_text", text: "Submit" },
    },
  });
});

app.view("conduct_report", async ({ ack, view, client }) => {
  await ack();
  try {
    const values = view.state.values;
    const { channel, thread_ts, permalink } = JSON.parse(view.private_metadata);

    const selectedUsers =
      values.reported_users.users_select.selected_users || [];
    const bannedUserIds = values.banned_user_ids.banned_ids_input.value
      ? values.banned_user_ids.banned_ids_input.value
          .split(",")
          .map((id) => id.trim())
      : [];

    const allUserIds = [...selectedUsers, ...bannedUserIds];
    const banDate = values.ban_until.ban_date_input.selected_date;

    const dropdwnsolutions =
      values.solution_deets?.solution_select?.selected_options?.map(
        (opt) => opt.value
      ) || [];
    const customsolution = values.custom_solution?.solution_custom_input?.value;
    const finalsolution = customsolution
      ? customsolution
      : dropdwnsolutions.length > 0
        ? dropdwnsolutions.join(", ")
        : "";

    const reportedUserName =
      values.reported_user_name?.reported_user_name_input?.value || "";
    const targetedUser = await userClient.users.info({ user: allUserIds[0] });
    const reportedUserEmail = targetedUser.user?.profile?.email || "";

    if (allUserIds.length === 0) {
      throw new Error("Select users or enter their user IDs");
    }

    if (!finalsolution || finalsolution.trim() === "") {
      throw new Error("Uhm you need to tell us how this was dealt with :P");
    }

    const threadKey = `${channel}-${thread_ts}`;
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
      displayName =
        userProfile.profile.display_name || userProfile.profile.real_name;

      await base("LYLA Records").create([
        {
          fields: {
            "Time Of Report": new Date().toISOString(),
            "Dealt With By":
              values.resolved_by.resolver_select.selected_users.join(", "),
            "User Being Dealt With": userId,
            "Display Name": displayName,
            "What Did User Do":
              values.violation_deets.violation_deets_input.value,
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
      `*Reported Users:*\n${allUserIds
        .map((id) => `<@${id.replace(/[<@>]/g, "")}>`)
        .join(", ")}`,
      // `*Reported User's Name:*\n${reportedUserName || "N/A"}`,
      `*Reported User's Email:*\n${reportedUserEmail || "N/A"}`,
      `*Resolved By:*\n${values.resolved_by.resolver_select.selected_users
        .map((user) => `<@${user}>`)
        .join(", ")}`,
      `*What Did They Do?*\n${values.violation_deets.violation_deets_input.value}`,
      `*How Did We Deal With This?*\n${finalsolution}`,
      `*If Banned or Shushed, Until:*\n${
        values.ban_until.ban_date_input.selected_date
          ? new Date(
              values.ban_until.ban_date_input.selected_date
            ).toLocaleDateString("en-GB", {
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
      const solution = finalsolution.toLowerCase().replace(/[\s\-_]/g, '');
      const excludeChannel = 
        solution.includes("channelban") ||
        solution.includes("channelshush");
      
      if (!excludeChannel) {
        const userMention = allUserIds
          .map((id) => `<@${id.replace(/[<@>]/g, "")}>`)
          .join(", ");

        let notifmsg;
        if (finalsolution.toLowerCase().includes("perma")) {
          notifmsg = `${userMention} has been permanently banned... be good kids ^^`;
        } else {
          const dateFormat = new Date(banDate).toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
            year: "numeric",
          });
          const action = finalsolution.toLowerCase().includes("shush")
            ? "shushed"
            : "banned";
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

app.command(
  /^\/(.*dev-)?prevreports$/,
  async ({ command, ack, client, respond }) => {
    await ack();
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
          text: "Use the format: `/prevreports @user slack|airtable`",
          response_type: "ephemeral",
        });
      }
      const cleanUserId = userId.startsWith("<@")
        ? userId.slice(2, -1).split("|")[0]
        : userId.replace(/[<@>]/g, "");
      if (source.toLowerCase() === "slack") {
        const msgSearch = await userClient.search.messages({
          query: `in:#hq-firehouse <@${cleanUserId}>`,
          count: 100,
          sort: "timestamp",
          sort_dir: "asc",
        });
        let allMessages = [...msgSearch.messages.matches];
        allMessages = allMessages.filter((match) => {
          const mentionsUser = match.text.includes(`<@${cleanUserId}>`);
          const isThreadMessage =
            match.thread_ts && match.thread_ts !== match.ts;
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
            match.text.length > 200
              ? match.text.substring(0, 200) + "..."
              : match.text;
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
        const records = await base("LYLA Records")
          .select({
            filterByFormula: `{User Being Dealt With} = '${cleanUserId}'`,
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
          const date = new Date(fields["Time Of Report"]).toLocaleDateString(
            "en-GB",
            {
              day: "numeric",
              month: "short",
              year: "numeric",
            }
          );
          const dealtWithBy = formatUserMentions(fields["Dealt With By"]);
          let reportText = `*Report from ${date}*
*Dealt With By:* ${dealtWithBy}
*What Did User Do:* ${fields["What Did User Do"]}
*How Was This Resolved:* ${fields["How Was This Resolved"]}
<${fields["Link To Message"]}|View Message>`;

          return reportText;
        });

        const messageText = `Airtable records for ${userId}:\n\n${reportEntries.join(
          "\n\n"
        )}`;

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
  }
);

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
      const banEndDate = new Date(
        record.fields["If Banned, Until When"]
      ).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
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

async function checkPendingThreads(client) {
  const now = Date.now();

  const hourglassEmojis = [
    "hourglass",
    "hourglass_flowing_sand",
    "hourglass_not_done",
  ];
  const tickReactions = [
    "heavy_check_mark",
    "white_tick",
    "white_check_mark",
    "check",
  ];
  const xReactions = ["x"];

  for (const [threadKey, threadData] of threadTracker.entries()) {
    if (threadData.report_filed) {
      continue;
    }

    let rootMsg;
    try {
      const repliesResp = await client.conversations.replies({
        channel: threadData.channel,
        ts: threadData.thread_ts,
        limit: 1,
        inclusive: true,
      });
      rootMsg = repliesResp.messages && repliesResp.messages[0];
    } catch (err) {
      continue;
    }
    if (!rootMsg || !rootMsg.reactions) continue;

    const reactions = rootMsg.reactions.map((r) => r.name);
    const hasHourglass = reactions.some((r) => hourglassEmojis.includes(r));
    const hasTick = tickReactions.some((tick) => reactions.includes(tick));
    const hasX = xReactions.some((x) => reactions.includes(x));

    if (hasTick || hasX) {
      threadTracker.delete(threadKey);
      continue;
    }

    if (hasHourglass) {
      const lastTrigger =
        threadData.last_pending_msg_time ||
        threadData.last_prompt_time ||
        threadData.ban_reaction_time;
      const timeSinceLastTrigger = now - lastTrigger;
      const fiveHours = 5 * 60 * 60 * 1000;
      if (timeSinceLastTrigger >= fiveHours) {
        try {
          const pendingMessage = await client.chat.postMessage({
            channel: threadData.channel,
            thread_ts: threadData.thread_ts,
            text: "Pending…",
            reply_broadcast: true,
          });

          threadData.pending_message_ts = pendingMessage.ts;
          threadData.last_pending_msg_time = now;

          if (!reactions.includes("bangbang")) {
            await client.reactions.add({
              channel: threadData.channel,
              timestamp: threadData.thread_ts,
              name: "bangbang",
            });
          }
        } catch (error) {
          console.error(error);
        }
      }
    }
  }

  const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
  for (const [threadKey, threadData] of threadTracker.entries()) {
    if (now - threadData.ban_reaction_time > SEVEN_DAYS) {
      threadTracker.delete(threadKey);
    }
  }
}

app.event("reaction_added", async ({ event, client }) => {
  if (event.item.channel !== ALLOWED_CHANNELS[0]) return;

  const reaction = event.reaction;
  const isCancel = reaction === "x";
  const isResolve =
    reaction === "heavy_check_mark" ||
    reaction === "white_tick" ||
    reaction === "white_check_mark" ||
    reaction === "check";

  if (!isCancel && !isResolve) {
    return;
  }

  let threadKey = `${event.item.channel}-${event.item.ts}`;
  if (!threadTracker.has(threadKey)) {
    for (const [key, data] of threadTracker.entries()) {
      if (
        data.pending_message_ts === event.item.ts &&
        data.channel === event.item.channel
      ) {
        threadKey = key;
        break;
      }
    }
  }

  if (!threadTracker.has(threadKey)) return;

  const threadData = threadTracker.get(threadKey);

  if (isCancel || isResolve) {
    threadTracker.delete(threadKey);
    await client.reactions.remove({
      channel: threadData.channel,
      timestamp: threadData.thread_ts,
      name: "bangbang",
    });
    return;
  }
});

(async () => {
  await app.start();
  console.log("⚡️ Bolt app is running!");

  schedule.scheduleJob(
    {
      hour: 7,
      minute: 0,
      tz: "America/New_York",
    },
    async () => {
      await checkBansForToday(app.client);
    }
  );

  schedule.scheduleJob("*/30 * * * * *", async () => {
    await checkPendingThreads(app.client);
  });
})();
