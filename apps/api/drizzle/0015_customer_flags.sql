ALTER TABLE "accounts" ADD COLUMN "flag_note" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "cod_blocked" boolean DEFAULT false NOT NULL;