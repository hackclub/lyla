import {
  pgTable,
  text,
  bigint,
  boolean,
  serial,
  integer,
  jsonb,
  primaryKey,
  index,
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
  caseNumber: integer("case_number").notNull(),
  actionType: text("action_type").notNull(),
  targetUserId: text("target_user_id").notNull(),
  performedBy: text("performed_by").array().notNull(),
  data: jsonb("data").notNull().default({}),
  performedAt: bigint("performed_at", { mode: "number" }).notNull(),
  categoryCode: integer("category_code").references(() => infractionCategories.code, {
    onDelete: "set null",
  }),
  categoryExtra: text("category_extra"),
  updatedAt: bigint("updated_at", { mode: "number" }),
  ucatId: text("ucat_id"),
  ucatSyncPending: boolean("ucat_sync_pending").notNull().default(false),
  airtableRecordId: text("airtable_record_id"),
});

export const infractionCategories = pgTable("infraction_categories", {
  code: integer("code").primaryKey(),
  name: text("name").notNull(),
  groupName: text("group_name"),
  ladderNoPriors: jsonb("ladder_no_priors").notNull().default([]),
  ladderWithPriors: jsonb("ladder_with_priors").notNull().default([]),
  notes: text("notes"),
  active: boolean("active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const appState = pgTable("app_state", {
  key: text("key").primaryKey(),
  value: text("value"),
});

export const auditLog = pgTable(
  "audit_log",
  {
    id: serial("id").primaryKey(),
    subjectType: text("subject_type").notNull(),
    subjectId: integer("subject_id").notNull(),
    changeType: text("change_type").notNull(),
    actorId: text("actor_id").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    caseNumber: integer("case_number"),
    targetUserId: text("target_user_id"),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (t) => [index("audit_log_subject_idx").on(t.subjectType, t.subjectId)]
);

export const userNotes = pgTable("user_notes", {
  id: serial("id").primaryKey(),
  targetUserId: text("target_user_id").notNull(),
  body: text("body").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  editedBy: text("edited_by"),
  editedAt: bigint("edited_at", { mode: "number" }),
});
