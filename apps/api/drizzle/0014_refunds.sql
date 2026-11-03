CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"order_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"case_id" uuid,
	"customer_id" uuid NOT NULL,
	"rider_id" uuid,
	"amount_cents" bigint NOT NULL,
	"reason_code" text NOT NULL,
	"attribution" text NOT NULL,
	"note" text,
	"status" text DEFAULT 'owed' NOT NULL,
	"issued_by" uuid NOT NULL,
	"paid_by" uuid,
	"paid_reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	CONSTRAINT "refund_positive" CHECK ("refunds"."amount_cents" > 0),
	CONSTRAINT "rider_refund_has_rider" CHECK ("refunds"."attribution" <> 'rider' or "refunds"."rider_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "settlement_lines" ADD COLUMN "refund_id" uuid;--> statement-breakpoint
ALTER TABLE "support_cases" ADD COLUMN "location" geometry(Point, 4326);--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_tenant_id_restaurants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."restaurants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_case_id_support_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."support_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_customer_id_accounts_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_rider_id_accounts_id_fk" FOREIGN KEY ("rider_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_issued_by_accounts_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_paid_by_accounts_id_fk" FOREIGN KEY ("paid_by") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "refunds_order_id_index" ON "refunds" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "refunds_status_index" ON "refunds" USING btree ("status");--> statement-breakpoint
ALTER TABLE "settlement_lines" ADD CONSTRAINT "settlement_lines_refund_id_refunds_id_fk" FOREIGN KEY ("refund_id") REFERENCES "public"."refunds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "refunds" TO oyo_app
  USING (app_is_platform() OR tenant_id = app_tenant_id())
  WITH CHECK (app_is_platform() OR tenant_id = app_tenant_id());
