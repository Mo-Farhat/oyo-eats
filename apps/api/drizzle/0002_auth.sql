CREATE TYPE "public"."device_status" AS ENUM('approved', 'pending', 'revoked');--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"account_id" uuid NOT NULL,
	"device_id" text NOT NULL,
	"platform" text,
	"status" "device_status" NOT NULL,
	"approved_by" uuid,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "otp_challenges" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"phone_hash" text NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"ip" "inet",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"account_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"device_id" text,
	"access_token_hash" text NOT NULL,
	"refresh_token_hash" text NOT NULL,
	"access_expires_at" timestamp with time zone NOT NULL,
	"refresh_expires_at" timestamp with time zone NOT NULL,
	"limited" boolean DEFAULT false NOT NULL,
	"ip" "inet",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rotated_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoke_reason" text
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "password_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "failed_login_count" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "locked_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "totp_pending_secret_ciphertext" "bytea";--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "totp_last_step" bigint;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "terms_accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_approved_by_accounts_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "devices_account_id_device_id_index" ON "devices" USING btree ("account_id","device_id");--> statement-breakpoint
CREATE INDEX "otp_challenges_phone_hash_created_at_index" ON "otp_challenges" USING btree ("phone_hash","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_access_token_hash_index" ON "sessions" USING btree ("access_token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_refresh_token_hash_index" ON "sessions" USING btree ("refresh_token_hash");--> statement-breakpoint
CREATE INDEX "sessions_family_id_index" ON "sessions" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "sessions_account_id_index" ON "sessions" USING btree ("account_id");--> statement-breakpoint
ALTER TABLE "otp_challenges" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY platform_only ON "otp_challenges" TO oyo_app USING (app_is_platform()) WITH CHECK (app_is_platform());--> statement-breakpoint
ALTER TABLE "devices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY platform_only ON "devices" TO oyo_app USING (app_is_platform()) WITH CHECK (app_is_platform());--> statement-breakpoint
ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY platform_only ON "sessions" TO oyo_app USING (app_is_platform()) WITH CHECK (app_is_platform());
