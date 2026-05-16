CREATE TABLE "case_actions" (
	"id" serial PRIMARY KEY NOT NULL,
	"case_number" integer NOT NULL,
	"action_type" text NOT NULL,
	"target_user_id" text NOT NULL,
	"performed_by" text[] NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"performed_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "case_assignees" (
	"case_number" integer NOT NULL,
	"user_id" text NOT NULL,
	"assigned_at" bigint NOT NULL,
	"assignment_source" text,
	CONSTRAINT "case_assignees_case_number_user_id_pk" PRIMARY KEY("case_number","user_id")
);
--> statement-breakpoint
CREATE TABLE "case_threads" (
	"case_number" integer NOT NULL,
	"channel" text NOT NULL,
	"thread_ts" text NOT NULL,
	"added_at" bigint NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	CONSTRAINT "case_threads_channel_thread_ts_pk" PRIMARY KEY("channel","thread_ts")
);
--> statement-breakpoint
CREATE TABLE "cases" (
	"case_number" serial PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"created_at" bigint NOT NULL,
	"resolved_at" bigint,
	"resolved_by" text,
	"resolution_kind" text,
	"merged_into" integer
);
--> statement-breakpoint
DROP TABLE "tracked_threads" CASCADE;
