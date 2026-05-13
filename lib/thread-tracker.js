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
      report_filed: false,
    });
  }
  return threadTracker.get(key);
}

export { threadTracker, makeThreadKey, ensureTrackedThread };
