CREATE TABLE "product_view_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "merchant_id" uuid NOT NULL,
  "product_id" uuid NOT NULL,
  "search_id" uuid NOT NULL,
  "discovery_session_id" uuid,
  "transport" text NOT NULL,
  "surface" text NOT NULL,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "product_view_event_transport" CHECK ("product_view_events"."transport" in ('rest','mcp','ucp')),
  CONSTRAINT "product_view_event_surface" CHECK ("product_view_events"."surface" in ('web','chatgpt','gemini','brand_widget'))
);
--> statement-breakpoint
ALTER TABLE "product_view_events" ADD CONSTRAINT "product_view_events_merchant_id_product_id_products_merchant_id_id_fk" FOREIGN KEY ("merchant_id","product_id") REFERENCES "public"."products"("merchant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "product_view_events" ADD CONSTRAINT "product_view_events_discovery_session_id_discovery_sessions_id_fk" FOREIGN KEY ("discovery_session_id") REFERENCES "public"."discovery_sessions"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "product_view_events_reporting" ON "product_view_events" USING btree ("merchant_id","occurred_at");
--> statement-breakpoint
CREATE INDEX "product_view_events_surface_reporting" ON "product_view_events" USING btree ("merchant_id","surface","occurred_at");
--> statement-breakpoint
CREATE INDEX "product_view_events_discovery_session" ON "product_view_events" USING btree ("discovery_session_id","occurred_at");
--> statement-breakpoint
GRANT INSERT ON product_view_events TO shopai_public;
--> statement-breakpoint
GRANT SELECT ON product_view_events TO shopai_app;
--> statement-breakpoint
ALTER TABLE product_view_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE product_view_events FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY public_product_view_events_insert ON product_view_events FOR INSERT TO shopai_public
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM products p
      INNER JOIN merchants m ON m.id = p.merchant_id
      WHERE p.id = product_view_events.product_id
        AND p.merchant_id = product_view_events.merchant_id
        AND p.published = true
        AND m.active = true
        AND m.is_public = true
    )
  );
--> statement-breakpoint
CREATE POLICY tenant_product_view_events_select ON product_view_events FOR SELECT TO shopai_app
  USING (merchant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
