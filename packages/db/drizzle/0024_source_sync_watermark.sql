ALTER TABLE "source_connections"
ADD COLUMN "last_source_watermark_at" timestamp with time zone;
--> statement-breakpoint
UPDATE "source_connections"
SET "last_source_watermark_at" = "last_successful_sync_at"
WHERE "last_successful_sync_at" IS NOT NULL;
