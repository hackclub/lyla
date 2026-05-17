import {
  pgTable,
  text,
  bigint,
  boolean,
  serial,
  integer,
  jsonb,
  primaryKey,
} from "drizzle-orm/pg-core";

export const cases = pgTable("cases", {
  caseNumber: serial("case_number").primaryKey(),
  status: text("status").notNull(), // open | resolved | canceled | expired | merged
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  resolvedAt: bigint("resolved_at", { mode: "number" }),
  resolvedBy: text("resolved_by"),
  resolutionKind: text("resolution_kind"), // resolved | canceled | expired | merged
  mergedInto: integer("merged_into"), // FK to cases(case_number), set when status = merged
});

export const caseThreads = pgTable(
  "case_threads",
  {
    caseNumber: integer("case_number").notNull(), // FK to cases(case_number)
    channel: text("channel").notNull(),
    threadTs: text("thread_ts").notNull(),
    addedAt: bigint("added_at", { mode: "number" }).notNull(),
    isPrimary: boolean("is_primary").notNull().default(false),
    snippet: text("snippet"),
  },
  (t) => [primaryKey({ columns: [t.channel, t.threadTs] })]
);

export const caseAssignees = pgTable(
  "case_assignees",
  {
    caseNumber: integer("case_number").notNull(), // FK to cases(case_number)
    userId: text("user_id").notNull(),
    assignedAt: bigint("assigned_at", { mode: "number" }).notNull(),
    assignmentSource: text("assignment_source"), // "self" = user clicked Claim
  },
  (t) => [primaryKey({ columns: [t.caseNumber, t.userId] })]
);

export const caseActions = pgTable("case_actions", {
  id: serial("id").primaryKey(),
  caseNumber: integer("case_number").notNull(), // FK to cases(case_number)
  actionType: text("action_type").notNull(), // temp_ban | perma_ban | dm | warning | shush | locked_thread | etc.
  targetUserId: text("target_user_id").notNull(),
  performedBy: text("performed_by").array().notNull(),
  data: jsonb("data").notNull().default({}), // ban/shush dates, violation text, display name, email, etc.
  performedAt: bigint("performed_at", { mode: "number" }).notNull(),
});

export const appState = pgTable("app_state", {
  key: text("key").primaryKey(),
  value: text("value"),
});
