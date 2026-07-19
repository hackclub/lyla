import { isNull, or, eq } from "drizzle-orm";
import { db } from "../lib/db.js";
import { caseActions } from "../db/schema.js";
import { syncActionToUcat } from "../lib/case-tracker.js";
import { isUcatConfigured } from "../lib/ucat-client.js";

export default async function syncUnsyncedCaseActions() {
  if (!isUcatConfigured()) return;

  const pending = await db
    .select()
    .from(caseActions)
    .where(or(isNull(caseActions.ucatId), eq(caseActions.ucatSyncPending, true)));
  if (pending.length === 0) return;

  await Promise.all(pending.map(syncActionToUcat));
}
