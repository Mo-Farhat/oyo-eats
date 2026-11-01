CREATE TABLE "assignment_locks" (
	"order_id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "cash_collected_cents" bigint;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "cash_variance_reason" text;--> statement-breakpoint
ALTER TABLE "assignment_locks" ADD CONSTRAINT "assignment_locks_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_locks" ADD CONSTRAINT "assignment_locks_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_locks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY platform_only ON "assignment_locks" TO oyo_app USING (app_is_platform()) WITH CHECK (app_is_platform());
