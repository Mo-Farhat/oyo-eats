ALTER TABLE "restaurants" ADD COLUMN "cuisines" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "restaurants" ADD COLUMN "prep_minutes" smallint DEFAULT 20 NOT NULL;