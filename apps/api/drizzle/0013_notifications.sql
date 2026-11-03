CREATE TABLE "notification_runs" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"account_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"critical" boolean DEFAULT false NOT NULL,
	"push_status" text DEFAULT 'pending' NOT NULL,
	"push_attempts" smallint DEFAULT 0 NOT NULL,
	"push_error" text,
	"sent_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_tokens" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"account_id" uuid NOT NULL,
	"token" text NOT NULL,
	"platform" text,
	"device_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "notification_runs" ADD CONSTRAINT "notification_runs_event_id_order_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."order_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_tokens" ADD CONSTRAINT "push_tokens_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_account_id_created_at_index" ON "notifications" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_created_at_index" ON "notifications" USING btree ("created_at") WHERE "notifications"."push_status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "push_tokens_token_index" ON "push_tokens" USING btree ("token");--> statement-breakpoint
CREATE INDEX "push_tokens_account_id_index" ON "push_tokens" USING btree ("account_id");--> statement-breakpoint
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY platform_only ON "notifications" TO oyo_app USING (app_is_platform()) WITH CHECK (app_is_platform());--> statement-breakpoint
ALTER TABLE "notification_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY platform_only ON "notification_runs" TO oyo_app USING (app_is_platform()) WITH CHECK (app_is_platform());--> statement-breakpoint
ALTER TABLE "push_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY platform_only ON "push_tokens" TO oyo_app USING (app_is_platform()) WITH CHECK (app_is_platform());
