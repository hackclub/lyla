import { db } from "./db.js";
import { auditLog } from "../db/schema.js";
import { eq, desc, and, notLike } from "drizzle-orm";

export async function recordAudit(
  tx,
  {
    subjectType,
    subjectId,
    changeType,
    actorId,
    before,
    after = null,
    caseNumber = null,
    targetUserId = null,
  }
) {
  await tx.insert(auditLog).values({
    subjectType,
    subjectId,
    changeType,
    actorId,
    before,
    after,
    caseNumber,
    targetUserId,
    createdAt: Date.now(),
  });
}

export async function getAuditTrailForUser(targetUserId, limit) {
  const rows = await db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.targetUserId, targetUserId), notLike(auditLog.actorId, "airtable:%")))
    .orderBy(desc(auditLog.createdAt))
    .limit(limit + 1);
  return { entries: rows.slice(0, limit), hasMore: rows.length > limit };
}
