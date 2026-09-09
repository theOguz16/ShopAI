CREATE TABLE "conversion_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"external_order_id" text NOT NULL,
	"status" text NOT NULL,
	"currency" text NOT NULL,
	"gross_minor" bigint NOT NULL,
	"refunded_minor" bigint DEFAULT 0 NOT NULL,
	"search_id" uuid,
	"offer_id" uuid,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversion_orders_merchant_id_id_unique" UNIQUE("merchant_id","id"),
	CONSTRAINT "conversion_orders_connection_id_external_order_id_unique" UNIQUE("connection_id","external_order_id"),
	CONSTRAINT "conversion_order_status" CHECK ("conversion_orders"."status" in ('paid','cancelled','refunded')),
	CONSTRAINT "conversion_order_currency" CHECK ("conversion_orders"."currency" = 'TRY'),
	CONSTRAINT "conversion_order_amounts" CHECK ("conversion_orders"."gross_minor" >= 0 and "conversion_orders"."refunded_minor" >= 0 and "conversion_orders"."refunded_minor" <= "conversion_orders"."gross_minor")
);
--> statement-breakpoint
ALTER TABLE "source_connections" ADD COLUMN "conversion_tracking_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "conversion_orders" ADD CONSTRAINT "conversion_orders_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversion_orders" ADD CONSTRAINT "conversion_orders_merchant_id_connection_id_source_connections_merchant_id_id_fk" FOREIGN KEY ("merchant_id","connection_id") REFERENCES "public"."source_connections"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversion_orders" ADD CONSTRAINT "conversion_orders_merchant_id_offer_id_offers_merchant_id_id_fk" FOREIGN KEY ("merchant_id","offer_id") REFERENCES "public"."offers"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversion_orders_reporting" ON "conversion_orders" USING btree ("merchant_id","occurred_at");--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON conversion_orders TO shopai_app, shopai_worker;--> statement-breakpoint
ALTER TABLE conversion_orders ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE conversion_orders FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_conversion_orders ON conversion_orders FOR ALL TO shopai_app, shopai_worker
USING (merchant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
WITH CHECK (merchant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
