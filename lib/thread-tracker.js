const threadTracker = new Map();

function makeThreadKey(channel, ts) {
  return `${channel}-${ts}`;
}

function ensureTrackedThread(channel, ts) {
  const key = makeThreadKey(channel, ts);
  if (!threadTracker.has(key)) {
    threadTracker.set(key, {
      channel,
      thread_ts: ts,
      ban_reaction_time: Date.now(),
      conduct_prompt_sent: false,
      pending_message_sent: false,
      pending_message_ts: null,
      last_pending_msg_time: null,
      report_filed: false,
    });
  }
  return threadTracker.get(key);
}

function findTrackedThreadByPendingMessage(channel, ts) {
  for (const [key, data] of threadTracker.entries()) {
    if (data.pending_message_ts === ts && data.channel === channel) {
      return { key, data };
    }
  }
  return null;
}

module.exports = {
  threadTracker,
  makeThreadKey,
  ensureTrackedThread,
  findTrackedThreadByPendingMessage,
};
