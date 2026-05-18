import { setAssignees, getCasePrimaryThread } from "./case-tracker.js";
import { requestUpdate } from "../jobs/sticky-pending.js";
import { joinList } from "./slack-utils.js";

function mentionList(ids, actorId) {
  const sorted =
    actorId && ids.includes(actorId) ? [actorId, ...ids.filter((id) => id !== actorId)] : ids;
  return joinList(sorted.map((id) => (id === actorId ? "themselves" : `<@${id}>`)));
}

export async function applyAssigneeChanges(client, caseNumber, actorId, oldIds, newIds) {
  const added = newIds.filter((id) => !oldIds.includes(id));
  const removed = oldIds.filter((id) => !newIds.includes(id));

  await setAssignees(caseNumber, newIds);
  requestUpdate();

  if (added.length === 0 && removed.length === 0) return;

  const actor = `<@${actorId}>`;
  const ref = `(#\u200c${caseNumber})`;
  let text;
  if (added.length && removed.length) {
    text = `${actor} removed ${mentionList(removed, actorId)} and assigned ${mentionList(added, actorId)} to this case ${ref}`;
  } else if (added.length) {
    text = `${actor} assigned ${mentionList(added, actorId)} to this case ${ref}`;
  } else {
    text = `${actor} removed ${mentionList(removed, actorId)} from this case ${ref}`;
  }

  const thread = await getCasePrimaryThread(caseNumber);
  if (thread) {
    await client.chat
      .postMessage({ channel: thread.channel, thread_ts: thread.threadTs, text })
      .catch(() => {});
  }
}
