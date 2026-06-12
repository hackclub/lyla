import { db } from "./db.js";
import { cases, caseThreads, caseAssignees, caseActions } from "../db/schema.js";
import { eq, and, inArray, asc } from "drizzle-orm";
import { botClient } from "./clients.js";
import { resolveMentions, truncateToWordBoundary } from "./slack-utils.js";

// Creates a new case for the given thread, or returns the existing case if one
// already exists for that (channel, threadTs) pair. Idempotent.
async function fetchSnippet(channel, threadTs) {
  try {
    const resp = await botClient.conversations.replies({
      channel,
      ts: threadTs,
      limit: 1,
      inclusive: true,
    });
    const raw = resp.messages?.[0]?.text ?? null;
    if (!raw) return null;
    return truncateToWordBoundary(await resolveMentions(raw)) || null;
  } catch {
    return null;
  }
}

export async function createCase(channel, threadTs, createdAt) {
  const snippet = await fetchSnippet(channel, threadTs);
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
      snippet,
    });

    return newCase;
  });
}

export async function getCaseByThread(channel, threadTs) {
  const rows = await db
    .select({ case: cases })
    .from(caseThreads)
    .innerJoin(cases, eq(caseThreads.caseNumber, cases.caseNumber))
    .where(
      and(
        eq(caseThreads.channel, channel),
        eq(caseThreads.threadTs, threadTs),
        eq(caseThreads.isPrimary, true)
      )
    )
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

export async function getCasePrimaryThread(caseNumber) {
  const rows = await db
    .select()
    .from(caseThreads)
    .where(and(eq(caseThreads.caseNumber, caseNumber), eq(caseThreads.isPrimary, true)))
    .limit(1);
  return rows[0] ?? null;
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

// Merges `fromCaseNumber` into `toCaseNumber`. Moves all threads and assignees
// to the surviving case, then marks the source as merged.
export async function mergeCase(fromCaseNumber, toCaseNumber) {
  await db.transaction(async (tx) => {
    // Move threads to surviving case; demote any primary threads from the source
    // so the surviving case keeps exactly one primary thread (its own).
    await tx
      .update(caseThreads)
      .set({ caseNumber: toCaseNumber, isPrimary: false })
      .where(eq(caseThreads.caseNumber, fromCaseNumber));

    const existingAssignees = await tx
      .select()
      .from(caseAssignees)
      .where(eq(caseAssignees.caseNumber, toCaseNumber));
    const existingUserIds = new Set(existingAssignees.map((a) => a.userId));

    const fromAssignees = await tx
      .select()
      .from(caseAssignees)
      .where(eq(caseAssignees.caseNumber, fromCaseNumber));
    const toInsert = fromAssignees.filter((a) => !existingUserIds.has(a.userId));

    if (toInsert.length > 0) {
      await tx
        .insert(caseAssignees)
        .values(toInsert.map((a) => ({ ...a, caseNumber: toCaseNumber })));
    }

    await tx.delete(caseAssignees).where(eq(caseAssignees.caseNumber, fromCaseNumber));

    // dont record resolvedAt for the cases merged into others so the time isn't tracked
    await tx
      .update(cases)
      .set({
        status: "merged",
        resolvedAt: null,
        resolutionKind: "merged",
        mergedInto: toCaseNumber,
      })
      .where(eq(cases.caseNumber, fromCaseNumber));
  });
}

// Follows the mergedInto chain and returns the final surviving (non-merged) case.
export async function resolveMergeChain(caseNumber) {
  const seen = new Set();
  let current = await getCaseByNumber(caseNumber);
  while (current?.status === "merged" && current.mergedInto != null) {
    if (seen.has(current.caseNumber)) break; // cycle guard
    seen.add(current.caseNumber);
    current = await getCaseByNumber(current.mergedInto);
  }
  return current ?? null;
}

export async function setCaseStatus(caseNumber, status, actorId) {
  const isTerminal = status !== "open";
  await db
    .update(cases)
    .set({
      status,
      resolutionKind: isTerminal ? status : null,
      resolvedAt: isTerminal ? Date.now() : null,
      resolvedBy: isTerminal ? (actorId ?? null) : null,
    })
    .where(eq(cases.caseNumber, caseNumber));
}

export async function getCaseActions(caseNumber) {
  return db
    .select()
    .from(caseActions)
    .where(eq(caseActions.caseNumber, caseNumber))
    .orderBy(asc(caseActions.performedAt));
}

export async function deleteCaseAction(id) {
  await db.delete(caseActions).where(eq(caseActions.id, id));
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
