CREATE TABLE "app_state" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text
);
--> statement-breakpoint
CREATE TABLE "tracked_threads" (
	"channel" text NOT NULL,
	"thread_ts" text NOT NULL,
	"ban_reaction_time" bigint NOT NULL,
	CONSTRAINT "tracked_threads_channel_thread_ts_pk" PRIMARY KEY("channel","thread_ts")
);
