CREATE TABLE "interaction_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "event_key" uuid NOT NULL,
  "event_type" text NOT NULL,
  "merchant_id" uuid NOT NULL,
  "product_id" uuid,
  "discovery_session_id" uuid NOT NULL,
  "transport" text NOT NULL,
  "surface" text NOT NULL,
  "category" text,
  "filter_kind" text,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "interaction_event_type" CHECK ("interaction_events"."event_type" in ('category_selected','filter_applied','product_impression','product_saved','alert_created')),
  CONSTRAINT "interaction_event_transport" CHECK ("interaction_events"."transport" in ('rest','mcp','ucp')),
  CONSTRAINT "interaction_event_surface" CHECK ("interaction_events"."surface" in ('web','chatgpt','gemini','brand_widget'))
);
ALTER TABLE "interaction_events" ADD CONSTRAINT "interaction_events_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id");
ALTER TABLE "interaction_events" ADD CONSTRAINT "interaction_events_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id");
ALTER TABLE "interaction_events" ADD CONSTRAINT "interaction_events_discovery_session_id_discovery_sessions_id_fk" FOREIGN KEY ("discovery_session_id") REFERENCES "public"."discovery_sessions"("id");
CREATE UNIQUE INDEX "interaction_events_event_key_unique" ON "interaction_events" ("event_key");
CREATE INDEX "interaction_events_merchant_type_time" ON "interaction_events" ("merchant_id","event_type","occurred_at");
CREATE INDEX "interaction_events_session_time" ON "interaction_events" ("discovery_session_id","occurred_at");
GRANT SELECT, INSERT ON interaction_events TO shopai_public;
GRANT SELECT ON interaction_events TO shopai_app;
ALTER TABLE interaction_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE interaction_events FORCE ROW LEVEL SECURITY;
CREATE POLICY public_interaction_events_insert ON interaction_events FOR INSERT TO shopai_public
WITH CHECK (
  discovery_session_id = nullif(current_setting('app.discovery_session_id', true), '')::uuid
  AND EXISTS (SELECT 1 FROM merchants m WHERE m.id = interaction_events.merchant_id AND m.active AND m.is_public)
);
CREATE POLICY public_interaction_events_select ON interaction_events FOR SELECT TO shopai_public
USING (discovery_session_id = nullif(current_setting('app.discovery_session_id', true), '')::uuid);
CREATE POLICY tenant_interaction_events_select ON interaction_events FOR SELECT TO shopai_app
USING (merchant_id = nullif(current_setting('app.merchant_id', true), '')::uuid);
