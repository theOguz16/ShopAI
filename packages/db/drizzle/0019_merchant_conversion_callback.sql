ALTER TABLE "redirect_clicks" ADD CONSTRAINT "redirect_clicks_merchant_id_id_unique" UNIQUE("merchant_id","id");
--> statement-breakpoint
ALTER TABLE "conversion_orders" ADD COLUMN "click_id" uuid;
--> statement-breakpoint
ALTER TABLE "conversion_orders" ADD COLUMN "discovery_session_id" uuid;
--> statement-breakpoint
UPDATE "conversion_orders" AS conversion
SET
  "click_id" = attribution."click_id",
  "discovery_session_id" = attribution."discovery_session_id"
FROM (
  SELECT DISTINCT ON ("merchant_id", "search_id", "offer_id")
    "id" AS "click_id",
    "merchant_id",
    "search_id",
    "offer_id",
    "discovery_session_id"
  FROM "redirect_clicks"
  WHERE "classification" = 'human'
  ORDER BY "merchant_id", "search_id", "offer_id", "occurred_at" ASC, "id" ASC
) AS attribution
WHERE conversion."merchant_id" = attribution."merchant_id"
  AND conversion."search_id" = attribution."search_id"
  AND conversion."offer_id" = attribution."offer_id"
  AND conversion."click_id" IS NULL;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "conversion_orders"
    GROUP BY "merchant_id", "external_order_id"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate merchant/order ids must be reconciled before 0019';
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "conversion_orders" ADD CONSTRAINT "conversion_orders_merchant_id_external_order_id_unique" UNIQUE("merchant_id","external_order_id");
--> statement-breakpoint
ALTER TABLE "conversion_orders" ADD CONSTRAINT "conversion_orders_merchant_id_click_id_redirect_clicks_merchant_id_id_fk" FOREIGN KEY ("merchant_id","click_id") REFERENCES "public"."redirect_clicks"("merchant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "conversion_orders" ADD CONSTRAINT "conversion_orders_discovery_session_id_discovery_sessions_id_fk" FOREIGN KEY ("discovery_session_id") REFERENCES "public"."discovery_sessions"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "conversion_orders_click" ON "conversion_orders" USING btree ("merchant_id","click_id");
--> statement-breakpoint
CREATE INDEX "conversion_orders_discovery_session" ON "conversion_orders" USING btree ("discovery_session_id","occurred_at");
