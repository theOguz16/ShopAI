CREATE TABLE "redirect_clicks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"search_id" uuid NOT NULL,
	"offer_id" uuid NOT NULL,
	"merchant_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"classification" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "redirect_click_channel" CHECK ("redirect_clicks"."channel" in ('web','chatgpt','mcp')),
	CONSTRAINT "redirect_click_classification" CHECK ("redirect_clicks"."classification" in ('human','bot'))
);
--> statement-breakpoint
ALTER TABLE "redirect_clicks" ADD CONSTRAINT "redirect_clicks_merchant_id_offer_id_offers_merchant_id_id_fk" FOREIGN KEY ("merchant_id","offer_id") REFERENCES "public"."offers"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "redirect_clicks_reporting" ON "redirect_clicks" USING btree ("merchant_id","occurred_at","classification");--> statement-breakpoint
GRANT SELECT, INSERT ON redirect_clicks TO shopai_app, shopai_worker;--> statement-breakpoint
GRANT INSERT ON redirect_clicks TO shopai_public;--> statement-breakpoint
ALTER TABLE redirect_clicks ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE redirect_clicks FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_redirect_clicks ON redirect_clicks FOR SELECT TO shopai_app, shopai_worker
  USING (merchant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY public_insert_redirect_clicks ON redirect_clicks FOR INSERT TO shopai_public
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM offers o
      JOIN variants v ON v.id = o.variant_id AND v.merchant_id = o.merchant_id
      JOIN products p ON p.id = v.product_id AND p.merchant_id = v.merchant_id
      JOIN merchants m ON m.id = o.merchant_id
      WHERE o.id = offer_id AND o.merchant_id = redirect_clicks.merchant_id
        AND o.active = true AND p.published = true AND m.active = true
    )
  );
