import { db } from "./db.js";
import { cases, caseThreads, caseAssignees, caseActions } from "../db/schema.js";
import { eq, and, inArray } from "drizzle-orm";

// Creates a new case for the given thread, or returns the existing case if one
// already exists for that (channel, threadTs) pair. Idempotent.
export async function createCase(channel, threadTs, createdAt) {
  return db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(caseThreads)
      .where(and(eq(caseThreads.channel, channel), eq(caseThreads.threadTs, threadTs)))
      .limit(1);

    if (existing.length > 0) {
      const existingCase = await tx
        .select()
        .from(cases)
        .where(eq(cases.caseNumber, existing[0].caseNumber))
        .limit(1);
      return existingCase[0] ?? null;
    }

    const [newCase] = await tx.insert(cases).values({ status: "open", createdAt }).returning();

    await tx.insert(caseThreads).values({
      caseNumber: newCase.caseNumber,
      channel,
      threadTs,
      addedAt: createdAt,
      isPrimary: true,
    });

    return newCase;
  });
}

export async function getCaseByThread(channel, threadTs) {
  const rows = await db
    .select({ case: cases })
    .from(caseThreads)
    .innerJoin(cases, eq(caseThreads.caseNumber, cases.caseNumber))
    .where(and(eq(caseThreads.channel, channel), eq(caseThreads.threadTs, threadTs)))
    .limit(1);
  return rows[0]?.case ?? null;
}

export async function getCaseByNumber(caseNumber) {
  const rows = await db.select().from(cases).where(eq(cases.caseNumber, caseNumber)).limit(1);
  return rows[0] ?? null;
}

export async function getCaseAssignees(caseNumber) {
  return db.select().from(caseAssignees).where(eq(caseAssignees.caseNumber, caseNumber));
}

// Returns all open cases, each with their threads and assignees.
export async function getOpenCases() {
  const openCases = await db.select().from(cases).where(eq(cases.status, "open"));
  if (openCases.length === 0) return [];

  const caseNumbers = openCases.map((c) => c.caseNumber);

  const [threads, assignees] = await Promise.all([
    db.select().from(caseThreads).where(inArray(caseThreads.caseNumber, caseNumbers)),
    db.select().from(caseAssignees).where(inArray(caseAssignees.caseNumber, caseNumbers)),
  ]);

  return openCases.map((c) => ({
    ...c,
    threads: threads.filter((t) => t.caseNumber === c.caseNumber),
    assignees: assignees.filter((a) => a.caseNumber === c.caseNumber),
  }));
}

// Atomically assigns a user to a case. Returns true if newly assigned, false if already assigned.
export async function assignCase(caseNumber, userId, source = "self") {
  const result = await db
    .insert(caseAssignees)
    .values({ caseNumber, userId, assignedAt: Date.now(), assignmentSource: source })
    .onConflictDoNothing()
    .returning();
  return result.length > 0;
}

export async function resolveCase(caseNumber, resolvedBy, resolutionKind) {
  await db
    .update(cases)
    .set({
      status: resolutionKind,
      resolvedAt: Date.now(),
      resolvedBy: resolvedBy ?? null,
      resolutionKind,
    })
    .where(eq(cases.caseNumber, caseNumber));
}

// Replaces all assignees for a case with the given userIds. Pass [] to clear.
export async function setAssignees(caseNumber, userIds) {
  await db.transaction(async (tx) => {
    await tx.delete(caseAssignees).where(eq(caseAssignees.caseNumber, caseNumber));
    if (userIds.length > 0) {
      await tx.insert(caseAssignees).values(
        userIds.map((userId) => ({
          caseNumber,
          userId,
          assignedAt: Date.now(),
          assignmentSource: "manual",
        }))
      );
    }
  });
}

export async function recordAction(caseNumber, actionType, targetUserId, performedBy, data = {}) {
  await db.insert(caseActions).values({
    caseNumber,
    actionType,
    targetUserId,
    performedBy,
    data,
    performedAt: Date.now(),
  });
}
