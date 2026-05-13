import { db } from "./db.js";
import { trackedThreads } from "../db/schema.js";
import { eq, and } from "drizzle-orm";

export async function addThread(channel, thread_ts, ban_reaction_time) {
  await db
    .insert(trackedThreads)
    .values({ channel, threadTs: thread_ts, banReactionTime: ban_reaction_time })
    .onConflictDoNothing();
}

export async function removeThread(channel, thread_ts) {
  await db
    .delete(trackedThreads)
    .where(and(eq(trackedThreads.channel, channel), eq(trackedThreads.threadTs, thread_ts)));
}

export async function getAllThreads() {
  return db.select().from(trackedThreads);
}

export async function getThread(channel, thread_ts) {
  const rows = await db
    .select()
    .from(trackedThreads)
    .where(and(eq(trackedThreads.channel, channel), eq(trackedThreads.threadTs, thread_ts)));
  return rows[0] ?? null;
}
