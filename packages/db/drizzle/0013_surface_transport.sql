ALTER TABLE "search_events" ADD COLUMN "transport" text;
--> statement-breakpoint
ALTER TABLE "search_events" ADD COLUMN "surface" text;
--> statement-breakpoint
UPDATE "search_events"
SET
  "transport" = CASE WHEN "channel" = 'mcp' THEN 'mcp' ELSE 'rest' END,
  "surface" = CASE WHEN "channel" = 'mcp' THEN 'chatgpt' ELSE 'web' END;
--> statement-breakpoint
ALTER TABLE "search_events" ALTER COLUMN "transport" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "search_events" ALTER COLUMN "surface" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "search_events" DROP CONSTRAINT "search_event_channel";
--> statement-breakpoint
ALTER TABLE "search_events" DROP COLUMN "channel";
--> statement-breakpoint
ALTER TABLE "search_events" ADD CONSTRAINT "search_event_transport" CHECK ("search_events"."transport" in ('rest','mcp','ucp'));
--> statement-breakpoint
ALTER TABLE "search_events" ADD CONSTRAINT "search_event_surface" CHECK ("search_events"."surface" in ('web','chatgpt','gemini','brand_widget'));
--> statement-breakpoint
CREATE INDEX "search_events_surface_reporting" ON "search_events" USING btree ("merchant_id","surface","occurred_at");
--> statement-breakpoint
ALTER TABLE "redirect_clicks" ADD COLUMN "transport" text;
--> statement-breakpoint
ALTER TABLE "redirect_clicks" ADD COLUMN "surface" text;
--> statement-breakpoint
UPDATE "redirect_clicks"
SET
  "transport" = CASE WHEN "channel" = 'web' THEN 'rest' ELSE 'mcp' END,
  "surface" = CASE
    WHEN "channel" = 'web' THEN 'web'
    WHEN "channel" IN ('chatgpt', 'mcp') THEN 'chatgpt'
    ELSE 'brand_widget'
  END;
--> statement-breakpoint
ALTER TABLE "redirect_clicks" ALTER COLUMN "transport" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "redirect_clicks" ALTER COLUMN "surface" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "redirect_clicks" DROP CONSTRAINT "redirect_click_channel";
--> statement-breakpoint
ALTER TABLE "redirect_clicks" DROP COLUMN "channel";
--> statement-breakpoint
ALTER TABLE "redirect_clicks" ADD CONSTRAINT "redirect_click_transport" CHECK ("redirect_clicks"."transport" in ('rest','mcp','ucp'));
--> statement-breakpoint
ALTER TABLE "redirect_clicks" ADD CONSTRAINT "redirect_click_surface" CHECK ("redirect_clicks"."surface" in ('web','chatgpt','gemini','brand_widget'));
--> statement-breakpoint
CREATE INDEX "redirect_clicks_surface_reporting" ON "redirect_clicks" USING btree ("merchant_id","surface","occurred_at");
--> statement-breakpoint
ALTER TABLE "conversion_orders" ADD COLUMN "transport" text;
--> statement-breakpoint
ALTER TABLE "conversion_orders" ADD COLUMN "surface" text;
--> statement-breakpoint
UPDATE "conversion_orders" AS conversion
SET
  "transport" = attribution."transport",
  "surface" = attribution."surface"
FROM (
  SELECT DISTINCT ON ("merchant_id", "search_id")
    "merchant_id",
    "search_id",
    "transport",
    "surface"
  FROM "search_events"
  WHERE "search_id" IS NOT NULL
  ORDER BY "merchant_id", "search_id", "occurred_at" ASC
) AS attribution
WHERE
  conversion."merchant_id" = attribution."merchant_id"
  AND conversion."search_id" = attribution."search_id";
--> statement-breakpoint
ALTER TABLE "conversion_orders" ADD CONSTRAINT "conversion_order_transport" CHECK ("conversion_orders"."transport" in ('rest','mcp','ucp'));
--> statement-breakpoint
ALTER TABLE "conversion_orders" ADD CONSTRAINT "conversion_order_surface" CHECK ("conversion_orders"."surface" in ('web','chatgpt','gemini','brand_widget'));
--> statement-breakpoint
CREATE INDEX "conversion_orders_surface_reporting" ON "conversion_orders" USING btree ("merchant_id","surface","occurred_at");
