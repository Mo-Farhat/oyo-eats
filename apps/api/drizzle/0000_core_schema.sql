CREATE TYPE "public"."account_status" AS ENUM('active', 'deactivated');--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."delivery_status" AS ENUM('unassigned', 'offered', 'assigned');--> statement-breakpoint
CREATE TYPE "public"."kitchen_status" AS ENUM('preparing', 'ready');--> statement-breakpoint
CREATE TYPE "public"."ledger_account" AS ENUM('business_bank', 'gateway_clearing', 'rider_cash', 'restaurant_payable', 'rider_payable', 'customer_credit', 'delivery_fee_revenue', 'subscription_revenue', 'refund_expense', 'cash_variance');--> statement-breakpoint
CREATE TYPE "public"."offer_outcome" AS ENUM('pending', 'accepted', 'declined', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('awaiting_payment', 'awaiting_restaurant', 'active', 'picked_up', 'delivered', 'rejected', 'cancelled', 'failed');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('cod', 'bank_transfer', 'card');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'confirmed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."restaurant_status" AS ENUM('onboarding', 'active', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."review_subject" AS ENUM('restaurant', 'rider');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('customer', 'rider', 'restaurant_staff', 'restaurant_owner', 'dispatcher', 'owner');--> statement-breakpoint
CREATE TYPE "public"."settlement_party" AS ENUM('restaurant', 'rider');--> statement-breakpoint
CREATE TYPE "public"."settlement_status" AS ENUM('draft', 'reviewed', 'paid');--> statement-breakpoint
CREATE TYPE "public"."slip_status" AS ENUM('pending', 'approved', 'rejected', 'resubmit_requested');--> statement-breakpoint
CREATE TYPE "public"."support_status" AS ENUM('open', 'in_progress', 'resolved');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"role" "role" NOT NULL,
	"status" "account_status" DEFAULT 'active' NOT NULL,
	"display_name" text NOT NULL,
	"tenant_id" uuid,
	"phone_hash" text,
	"phone_ciphertext" "bytea",
	"username" text,
	"password_hash" text,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"totp_secret_ciphertext" "bytea",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deactivated_at" timestamp with time zone,
	CONSTRAINT "tenant_only_for_restaurant_roles" CHECK (("accounts"."role" in ('restaurant_staff', 'restaurant_owner')) = ("accounts"."tenant_id" is not null)),
	CONSTRAINT "customer_signs_in_by_phone" CHECK ("accounts"."role" <> 'customer' or "accounts"."phone_hash" is not null),
	CONSTRAINT "staff_sign_in_by_username" CHECK ("accounts"."role" = 'customer' or ("accounts"."username" is not null and "accounts"."password_hash" is not null))
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"actor_account_id" uuid,
	"actor_role" text NOT NULL,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text,
	"before" jsonb,
	"after" jsonb,
	"ip" "inet",
	"device_id" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_slips" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"image_key" text NOT NULL,
	"image_sha256" text NOT NULL,
	"bank_reference" text,
	"declared_amount_cents" bigint,
	"status" "slip_status" DEFAULT 'pending' NOT NULL,
	"reviewed_by" uuid,
	"review_reason" text,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "batches" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"rider_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cash_handovers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"rider_id" uuid NOT NULL,
	"amount_cents" bigint NOT NULL,
	"expected_cents" bigint NOT NULL,
	"variance_reason" text,
	"receipt_key" text,
	"recorded_by" uuid NOT NULL,
	"countersigned_by" uuid,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "variance_needs_reason" CHECK ("cash_handovers"."amount_cents" = "cash_handovers"."expected_cents" or "cash_handovers"."variance_reason" is not null)
);
--> statement-breakpoint
CREATE TABLE "customer_addresses" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"customer_id" uuid NOT NULL,
	"label" text NOT NULL,
	"location" geometry(Point, 4326) NOT NULL,
	"address_ciphertext" "bytea" NOT NULL,
	"note_ciphertext" "bytea",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"account" "ledger_account" NOT NULL,
	"party_id" uuid,
	"amount_cents" bigint NOT NULL,
	CONSTRAINT "amount_not_zero" CHECK ("ledger_entries"."amount_cents" <> 0)
);
--> statement-breakpoint
CREATE TABLE "ledger_transactions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"kind" text NOT NULL,
	"order_id" uuid,
	"reverses_id" uuid,
	"memo" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "menu_categories" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "menu_change_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"menu_item_id" uuid,
	"kind" text NOT NULL,
	"before" jsonb,
	"after" jsonb NOT NULL,
	"status" "approval_status" DEFAULT 'pending' NOT NULL,
	"admin_note" text,
	"requested_by" uuid NOT NULL,
	"reviewed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "menu_items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"price_cents" bigint NOT NULL,
	"photo_key" text,
	"dietary_tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"sold_out" boolean DEFAULT false NOT NULL,
	"approval_status" "approval_status" DEFAULT 'pending' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_positive" CHECK ("menu_items"."price_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "modifier_groups" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"menu_item_id" uuid NOT NULL,
	"name" text NOT NULL,
	"min_select" smallint DEFAULT 0 NOT NULL,
	"max_select" smallint DEFAULT 1 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "select_range" CHECK ("modifier_groups"."min_select" >= 0 and "modifier_groups"."max_select" >= "modifier_groups"."min_select")
);
--> statement-breakpoint
CREATE TABLE "modifiers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"name" text NOT NULL,
	"price_cents" bigint DEFAULT 0 NOT NULL,
	"sold_out" boolean DEFAULT false NOT NULL,
	CONSTRAINT "price_not_negative" CHECK ("modifiers"."price_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "offers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"order_id" uuid,
	"batch_id" uuid,
	"rider_id" uuid NOT NULL,
	"offered_by" uuid NOT NULL,
	"payout_cents" bigint NOT NULL,
	"outcome" "offer_outcome" DEFAULT 'pending' NOT NULL,
	"reason" text,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"responded_at" timestamp with time zone,
	CONSTRAINT "order_xor_batch" CHECK (("offers"."order_id" is null) <> ("offers"."batch_id" is null))
);
--> statement-breakpoint
CREATE TABLE "order_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"type" text NOT NULL,
	"actor_account_id" uuid,
	"actor_role" text NOT NULL,
	"device_id" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"menu_item_id" uuid NOT NULL,
	"name" text NOT NULL,
	"unit_price_cents" bigint NOT NULL,
	"modifiers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"quantity" smallint NOT NULL,
	"line_total_cents" bigint NOT NULL,
	"note" text,
	CONSTRAINT "quantity_positive" CHECK ("order_items"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"payment_method" "payment_method" NOT NULL,
	"status" "order_status" NOT NULL,
	"kitchen_status" "kitchen_status",
	"delivery_status" "delivery_status",
	"rider_id" uuid,
	"batch_id" uuid,
	"delivery_location" geometry(Point, 4326) NOT NULL,
	"delivery_address_ciphertext" "bytea",
	"delivery_note_ciphertext" "bytea",
	"route_distance_meters" integer NOT NULL,
	"fee_settings" jsonb NOT NULL,
	"items_cents" bigint NOT NULL,
	"delivery_fee_cents" bigint NOT NULL,
	"restaurant_fee_cents" bigint DEFAULT 0 NOT NULL,
	"total_cents" bigint NOT NULL,
	"prep_minutes" smallint,
	"placed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "total_adds_up" CHECK ("orders"."total_cents" = "orders"."items_cents" + "orders"."delivery_fee_cents" + "orders"."restaurant_fee_cents"),
	CONSTRAINT "tracks_set_after_accept" CHECK (("orders"."kitchen_status" is null) = ("orders"."delivery_status" is null))
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"method" "payment_method" NOT NULL,
	"amount_cents" bigint NOT NULL,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"gateway_reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "restaurant_hour_overrides" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"date" date NOT NULL,
	"closed" boolean DEFAULT true NOT NULL,
	"opens_at" time,
	"closes_at" time
);
--> statement-breakpoint
CREATE TABLE "restaurant_hours" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"opens_at" time NOT NULL,
	"closes_at" time NOT NULL,
	CONSTRAINT "weekday_range" CHECK ("restaurant_hours"."weekday" between 0 and 6)
);
--> statement-breakpoint
CREATE TABLE "restaurants" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"status" "restaurant_status" DEFAULT 'onboarding' NOT NULL,
	"location" geometry(Point, 4326) NOT NULL,
	"address_text" text NOT NULL,
	"paused_until" timestamp with time zone,
	"licence_number" text,
	"licence_expires_on" date,
	"bank_details_ciphertext" "bytea",
	"subscription_status" text DEFAULT 'trial' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"subject" "review_subject" NOT NULL,
	"rider_id" uuid,
	"rating" smallint NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"body" text,
	"reply" text,
	"hidden" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"editable_until" timestamp with time zone NOT NULL,
	CONSTRAINT "rating_range" CHECK ("reviews"."rating" between 1 and 5),
	CONSTRAINT "rider_review_has_rider" CHECK (("reviews"."subject" = 'rider') = ("reviews"."rider_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "rider_documents" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"rider_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"file_key" text NOT NULL,
	"document_number_ciphertext" "bytea",
	"expires_on" date,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rider_locations" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rider_locations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"rider_id" uuid NOT NULL,
	"location" geometry(Point, 4326) NOT NULL,
	"battery_percent" smallint,
	"mock" boolean DEFAULT false NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "riders" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"vehicle_type" text NOT NULL,
	"plate" text NOT NULL,
	"photo_key" text,
	"online" boolean DEFAULT false NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"consecutive_misses" smallint DEFAULT 0 NOT NULL,
	"last_location" geometry(Point, 4326),
	"last_seen_at" timestamp with time zone,
	"emergency_contact_ciphertext" "bytea"
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "settlement_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"settlement_id" uuid NOT NULL,
	"tenant_id" uuid,
	"order_id" uuid,
	"description" text NOT NULL,
	"amount_cents" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlements" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"party" "settlement_party" NOT NULL,
	"party_id" uuid NOT NULL,
	"tenant_id" uuid,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"total_cents" bigint NOT NULL,
	"status" "settlement_status" DEFAULT 'draft' NOT NULL,
	"checksum" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	CONSTRAINT "restaurant_settlement_has_tenant" CHECK (("settlements"."party" = 'restaurant') = ("settlements"."tenant_id" is not null)),
	CONSTRAINT "paid_has_checksum" CHECK ("settlements"."status" <> 'paid' or "settlements"."checksum" is not null)
);
--> statement-breakpoint
CREATE TABLE "support_cases" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"order_id" uuid,
	"tenant_id" uuid,
	"reporter_id" uuid NOT NULL,
	"type" text NOT NULL,
	"description" text,
	"evidence_keys" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" "support_status" DEFAULT 'open' NOT NULL,
	"assignee_id" uuid,
	"resolution" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_tenant_id_restaurants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."restaurants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_account_id_accounts_id_fk" FOREIGN KEY ("actor_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_slips" ADD CONSTRAINT "bank_slips_tenant_id_restaurants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."restaurants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_slips" ADD CONSTRAINT "bank_slips_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_slips" ADD CONSTRAINT "bank_slips_reviewed_by_accounts_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_rider_id_riders_account_id_fk" FOREIGN KEY ("rider_id") REFERENCES "public"."riders"("account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_handovers" ADD CONSTRAINT "cash_handovers_rider_id_riders_account_id_fk" FOREIGN KEY ("rider_id") REFERENCES "public"."riders"("account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_handovers" ADD CONSTRAINT "cash_handovers_recorded_by_accounts_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_handovers" ADD CONSTRAINT "cash_handovers_countersigned_by_accounts_id_fk" FOREIGN KEY ("countersigned_by") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_customer_id_accounts_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_transaction_id_ledger_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."ledger_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_reverses_id_ledger_transactions_id_fk" FOREIGN KEY ("reverses_id") REFERENCES "public"."ledger_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_categories" ADD CONSTRAINT "menu_categories_tenant_id_restaurants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."restaurants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_change_requests" ADD CONSTRAINT "menu_change_requests_tenant_id_restaurants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."restaurants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_change_requests" ADD CONSTRAINT "menu_change_requests_menu_item_id_menu_items_id_fk" FOREIGN KEY ("menu_item_id") REFERENCES "public"."menu_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_change_requests" ADD CONSTRAINT "menu_change_requests_requested_by_accounts_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_change_requests" ADD CONSTRAINT "menu_change_requests_reviewed_by_accounts_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_tenant_id_restaurants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."restaurants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_category_id_menu_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."menu_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modifier_groups" ADD CONSTRAINT "modifier_groups_tenant_id_restaurants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."restaurants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modifier_groups" ADD CONSTRAINT "modifier_groups_menu_item_id_menu_items_id_fk" FOREIGN KEY ("menu_item_id") REFERENCES "public"."menu_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modifiers" ADD CONSTRAINT "modifiers_tenant_id_restaurants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."restaurants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modifiers" ADD CONSTRAINT "modifiers_group_id_modifier_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."modifier_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_rider_id_riders_account_id_fk" FOREIGN KEY ("rider_id") REFERENCES "public"."riders"("account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_offered_by_accounts_id_fk" FOREIGN KEY ("offered_by") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_tenant_id_restaurants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."restaurants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_actor_account_id_accounts_id_fk" FOREIGN KEY ("actor_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_tenant_id_restaurants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."restaurants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_menu_item_id_menu_items_id_fk" FOREIGN KEY ("menu_item_id") REFERENCES "public"."menu_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_tenant_id_restaurants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."restaurants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_accounts_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_rider_id_riders_account_id_fk" FOREIGN KEY ("rider_id") REFERENCES "public"."riders"("account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_restaurants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."restaurants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restaurant_hour_overrides" ADD CONSTRAINT "restaurant_hour_overrides_tenant_id_restaurants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."restaurants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restaurant_hours" ADD CONSTRAINT "restaurant_hours_tenant_id_restaurants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."restaurants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_tenant_id_restaurants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."restaurants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_customer_id_accounts_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_rider_id_riders_account_id_fk" FOREIGN KEY ("rider_id") REFERENCES "public"."riders"("account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rider_documents" ADD CONSTRAINT "rider_documents_rider_id_riders_account_id_fk" FOREIGN KEY ("rider_id") REFERENCES "public"."riders"("account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rider_locations" ADD CONSTRAINT "rider_locations_rider_id_riders_account_id_fk" FOREIGN KEY ("rider_id") REFERENCES "public"."riders"("account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "riders" ADD CONSTRAINT "riders_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_lines" ADD CONSTRAINT "settlement_lines_settlement_id_settlements_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."settlements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_lines" ADD CONSTRAINT "settlement_lines_tenant_id_restaurants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."restaurants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_lines" ADD CONSTRAINT "settlement_lines_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_tenant_id_restaurants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."restaurants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_cases" ADD CONSTRAINT "support_cases_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_cases" ADD CONSTRAINT "support_cases_tenant_id_restaurants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."restaurants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_cases" ADD CONSTRAINT "support_cases_reporter_id_accounts_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_cases" ADD CONSTRAINT "support_cases_assignee_id_accounts_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_phone_hash_index" ON "accounts" USING btree ("phone_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_username_lower_idx" ON "accounts" USING btree (lower("username"));--> statement-breakpoint
CREATE INDEX "audit_log_occurred_at_index" ON "audit_log" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "audit_log_actor_account_id_occurred_at_index" ON "audit_log" USING btree ("actor_account_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_log_target_type_target_id_index" ON "audit_log" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bank_slips_image_sha256_index" ON "bank_slips" USING btree ("image_sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "bank_slips_bank_reference_index" ON "bank_slips" USING btree ("bank_reference");--> statement-breakpoint
CREATE INDEX "bank_slips_status_uploaded_at_index" ON "bank_slips" USING btree ("status","uploaded_at");--> statement-breakpoint
CREATE INDEX "cash_handovers_rider_id_recorded_at_index" ON "cash_handovers" USING btree ("rider_id","recorded_at");--> statement-breakpoint
CREATE INDEX "customer_addresses_customer_id_index" ON "customer_addresses" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_transaction_id_index" ON "ledger_entries" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_account_party_id_index" ON "ledger_entries" USING btree ("account","party_id");--> statement-breakpoint
CREATE INDEX "ledger_transactions_order_id_index" ON "ledger_transactions" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_transactions_reverses_id_index" ON "ledger_transactions" USING btree ("reverses_id");--> statement-breakpoint
CREATE INDEX "menu_categories_tenant_id_index" ON "menu_categories" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "menu_change_requests_tenant_id_status_index" ON "menu_change_requests" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "menu_items_tenant_id_category_id_index" ON "menu_items" USING btree ("tenant_id","category_id");--> statement-breakpoint
CREATE INDEX "modifier_groups_menu_item_id_index" ON "modifier_groups" USING btree ("menu_item_id");--> statement-breakpoint
CREATE INDEX "modifiers_group_id_index" ON "modifiers" USING btree ("group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "offers_one_pending_per_order" ON "offers" USING btree ("order_id") WHERE "offers"."outcome" = 'pending' and "offers"."order_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "offers_one_pending_per_batch" ON "offers" USING btree ("batch_id") WHERE "offers"."outcome" = 'pending' and "offers"."batch_id" is not null;--> statement-breakpoint
CREATE INDEX "offers_rider_id_sent_at_index" ON "offers" USING btree ("rider_id","sent_at");--> statement-breakpoint
CREATE INDEX "order_events_order_id_occurred_at_index" ON "order_events" USING btree ("order_id","occurred_at");--> statement-breakpoint
CREATE INDEX "order_items_order_id_index" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_reference_index" ON "orders" USING btree ("reference");--> statement-breakpoint
CREATE INDEX "orders_tenant_id_status_index" ON "orders" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "orders_customer_id_placed_at_index" ON "orders" USING btree ("customer_id","placed_at");--> statement-breakpoint
CREATE INDEX "orders_rider_id_index" ON "orders" USING btree ("rider_id");--> statement-breakpoint
CREATE INDEX "orders_status_delivery_status_index" ON "orders" USING btree ("status","delivery_status");--> statement-breakpoint
CREATE INDEX "payments_order_id_index" ON "payments" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_gateway_reference_index" ON "payments" USING btree ("gateway_reference");--> statement-breakpoint
CREATE UNIQUE INDEX "restaurant_hour_overrides_tenant_id_date_index" ON "restaurant_hour_overrides" USING btree ("tenant_id","date");--> statement-breakpoint
CREATE INDEX "restaurant_hours_tenant_id_weekday_index" ON "restaurant_hours" USING btree ("tenant_id","weekday");--> statement-breakpoint
CREATE INDEX "restaurants_location_index" ON "restaurants" USING gist ("location");--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_order_id_subject_index" ON "reviews" USING btree ("order_id","subject");--> statement-breakpoint
CREATE INDEX "reviews_tenant_id_created_at_index" ON "reviews" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "rider_documents_rider_id_index" ON "rider_documents" USING btree ("rider_id");--> statement-breakpoint
CREATE INDEX "rider_locations_rider_id_recorded_at_index" ON "rider_locations" USING btree ("rider_id","recorded_at");--> statement-breakpoint
CREATE INDEX "riders_last_location_index" ON "riders" USING gist ("last_location");--> statement-breakpoint
CREATE INDEX "settlement_lines_settlement_id_index" ON "settlement_lines" USING btree ("settlement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "settlements_party_party_id_period_start_index" ON "settlements" USING btree ("party","party_id","period_start");--> statement-breakpoint
CREATE INDEX "support_cases_status_created_at_index" ON "support_cases" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "support_cases_order_id_index" ON "support_cases" USING btree ("order_id");