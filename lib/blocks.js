function getConductPromptBlocks() {
  return [
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
  ];
}

function buildConductModalBlocks(initialResolverUserId) {
  return [
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
      block_id: "resolved_by",
      label: {
        type: "plain_text",
        text: "Who Resolved This? (Thank you btw <3)",
      },
      element: {
        type: "multi_users_select",
        action_id: "resolver_select",
        initial_users: [initialResolverUserId],
      },
    },
  ];
}

export { getConductPromptBlocks, buildConductModalBlocks };
