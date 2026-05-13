import { pgTable, text, bigint, primaryKey } from "drizzle-orm/pg-core";

export const trackedThreads = pgTable(
  "tracked_threads",
  {
    channel: text("channel").notNull(),
    threadTs: text("thread_ts").notNull(),
    banReactionTime: bigint("ban_reaction_time", { mode: "number" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.channel, t.threadTs] })]
);

export const appState = pgTable("app_state", {
  key: text("key").primaryKey(),
  value: text("value"),
});
