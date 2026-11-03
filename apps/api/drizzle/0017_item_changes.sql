CREATE TABLE "order_item_changes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"order_item_id" uuid,
	"name" text NOT NULL,
	"quantity" smallint NOT NULL,
	"available_quantity" smallint NOT NULL,
	"missing_cents" bigint NOT NULL,
	"substitute_menu_item_id" uuid,
	"substitute_name" text,
	"substitute_unit_price_cents" bigint,
	"status" text DEFAULT 'pending' NOT NULL,
	"resolved_by" text,
	"respond_by" timestamp with time zone NOT NULL,
	"refund_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "available_less_than_ordered" CHECK ("order_item_changes"."available_quantity" >= 0 and "order_item_changes"."available_quantity" < "order_item_changes"."quantity"),
	CONSTRAINT "substitute_complete" CHECK (("order_item_changes"."substitute_menu_item_id" is null) = ("order_item_changes"."substitute_unit_price_cents" is null))
);
--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "order_adjusted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "order_item_changes" ADD CONSTRAINT "order_item_changes_tenant_id_restaurants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."restaurants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_item_changes" ADD CONSTRAINT "order_item_changes_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_item_changes" ADD CONSTRAINT "order_item_changes_substitute_menu_item_id_menu_items_id_fk" FOREIGN KEY ("substitute_menu_item_id") REFERENCES "public"."menu_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_item_changes" ADD CONSTRAINT "order_item_changes_refund_id_refunds_id_fk" FOREIGN KEY ("refund_id") REFERENCES "public"."refunds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_item_changes" ADD CONSTRAINT "order_item_changes_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_item_changes_order_id_index" ON "order_item_changes" USING btree ("order_id");--> statement-breakpoint
ALTER TABLE "order_item_changes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "order_item_changes" TO oyo_app
  USING (app_is_platform() OR tenant_id = app_tenant_id())
  WITH CHECK (app_is_platform() OR tenant_id = app_tenant_id());--> statement-breakpoint
-- The customer's answer window for an unavailable item (RES-05), added to the existing timers.
UPDATE "settings" SET "value" = "value" || '{"itemChangeSeconds": 180}'::jsonb
  WHERE "key" = 'timers' AND NOT ("value" ? 'itemChangeSeconds');
