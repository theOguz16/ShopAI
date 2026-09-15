ALTER TABLE "search_events"
ADD COLUMN "intent" text DEFAULT 'explicit_search' NOT NULL;
--> statement-breakpoint
UPDATE "search_events"
SET "intent" = 'pagination'
WHERE "request_kind" = 'pagination';
--> statement-breakpoint
ALTER TABLE "search_events"
ADD CONSTRAINT "search_event_intent"
CHECK ("intent" in ('catalog_load','explicit_search','refinement','pagination'));
--> statement-breakpoint
CREATE INDEX "search_events_intent_reporting"
ON "search_events" USING btree ("merchant_id","intent","occurred_at");
