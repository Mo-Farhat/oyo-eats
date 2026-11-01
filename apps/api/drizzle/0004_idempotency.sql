CREATE TABLE "idempotency_keys" (
	"account_id" uuid NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_status" smallint,
	"response_body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "idempotency_keys_account_id_key_pk" PRIMARY KEY("account_id","key")
);
--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idempotency_keys_expires_at_index" ON "idempotency_keys" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "idempotency_keys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY platform_only ON "idempotency_keys" TO oyo_app USING (app_is_platform()) WITH CHECK (app_is_platform());
