ALTER TABLE "merchants" ADD COLUMN "display_name" text;
--> statement-breakpoint
ALTER TABLE "merchants" ADD COLUMN "logo_url" text;
--> statement-breakpoint
ALTER TABLE "merchants" ADD COLUMN "cover_image_url" text;
--> statement-breakpoint
ALTER TABLE "merchants" ADD COLUMN "primary_color" text DEFAULT '#111111' NOT NULL;
--> statement-breakpoint
ALTER TABLE "merchants" ADD COLUMN "is_public" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
UPDATE "merchants" SET "display_name" = "name" WHERE "display_name" IS NULL;
--> statement-breakpoint
ALTER TABLE "merchants" ALTER COLUMN "display_name" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "merchants" ADD CONSTRAINT "merchant_primary_color" CHECK ("merchants"."primary_color" ~ '^#[0-9A-Fa-f]{6}$');
