CREATE TABLE "search_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"search_id" uuid,
	"merchant_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"request_kind" text NOT NULL,
	"outcome" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "search_event_channel" CHECK ("search_events"."channel" in ('web','mcp')),
	CONSTRAINT "search_event_request_kind" CHECK ("search_events"."request_kind" in ('initial','pagination')),
	CONSTRAINT "search_event_outcome" CHECK ("search_events"."outcome" in ('results','empty','error'))
);
--> statement-breakpoint
ALTER TABLE "search_events" ADD CONSTRAINT "search_events_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "search_events_reporting" ON "search_events" USING btree ("merchant_id","occurred_at","request_kind");
--> statement-breakpoint
GRANT INSERT ON search_events TO shopai_public;
--> statement-breakpoint
GRANT SELECT ON search_events TO shopai_app;
--> statement-breakpoint
ALTER TABLE search_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE search_events FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY public_search_events_insert ON search_events FOR INSERT TO shopai_public
  WITH CHECK (EXISTS (SELECT 1 FROM merchants WHERE merchants.id = merchant_id AND merchants.active = true));
--> statement-breakpoint
CREATE POLICY tenant_search_events_select ON search_events FOR SELECT TO shopai_app
  USING (merchant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
