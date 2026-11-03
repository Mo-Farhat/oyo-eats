CREATE TABLE "reconciliation_runs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"for_date" date NOT NULL,
	"ok" boolean NOT NULL,
	"issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"triggered_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reconciliation_runs" ADD CONSTRAINT "reconciliation_runs_triggered_by_accounts_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reconciliation_runs_created_at_index" ON "reconciliation_runs" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "reconciliation_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY platform_only ON "reconciliation_runs" TO oyo_app USING (app_is_platform()) WITH CHECK (app_is_platform());
