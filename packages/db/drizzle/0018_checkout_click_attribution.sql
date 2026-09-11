ALTER TABLE "redirect_clicks" ADD COLUMN "product_id" uuid;
--> statement-breakpoint
ALTER TABLE "redirect_clicks" ADD COLUMN "campaign" text;
--> statement-breakpoint
UPDATE "redirect_clicks" AS click
SET "product_id" = variant."product_id"
FROM "offers" AS offer
JOIN "variants" AS variant
  ON variant."id" = offer."variant_id"
  AND variant."merchant_id" = offer."merchant_id"
WHERE click."offer_id" = offer."id"
  AND click."merchant_id" = offer."merchant_id";
--> statement-breakpoint
UPDATE "redirect_clicks" AS click
SET "campaign" = session."campaign"
FROM "discovery_sessions" AS session
WHERE click."discovery_session_id" = session."id";
--> statement-breakpoint
ALTER TABLE "redirect_clicks" ALTER COLUMN "product_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "redirect_clicks" ADD CONSTRAINT "redirect_clicks_merchant_id_product_id_products_merchant_id_id_fk" FOREIGN KEY ("merchant_id","product_id") REFERENCES "public"."products"("merchant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "redirect_clicks_campaign_reporting" ON "redirect_clicks" USING btree ("merchant_id","campaign","occurred_at");
--> statement-breakpoint
DROP POLICY public_insert_redirect_clicks ON redirect_clicks;
--> statement-breakpoint
CREATE POLICY public_insert_redirect_clicks ON redirect_clicks FOR INSERT TO shopai_public
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM offers o
      JOIN variants v ON v.id = o.variant_id AND v.merchant_id = o.merchant_id
      JOIN products p ON p.id = v.product_id AND p.merchant_id = v.merchant_id
      JOIN merchants m ON m.id = o.merchant_id
      WHERE o.id = offer_id
        AND o.merchant_id = redirect_clicks.merchant_id
        AND v.product_id = redirect_clicks.product_id
        AND o.active = true
        AND p.published = true
        AND m.active = true
    )
  );
