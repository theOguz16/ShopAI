CREATE TABLE "source_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"credentials_ref" text,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "source_connections_merchant_id_id_unique" UNIQUE("merchant_id","id")
);
--> statement-breakpoint
CREATE TABLE "import_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"row_count" bigint NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory" (
	"offer_id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"available" boolean,
	"observed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"merchant_id" uuid NOT NULL,
	"role" text NOT NULL,
	CONSTRAINT "memberships_user_id_merchant_id_unique" UNIQUE("user_id","merchant_id"),
	CONSTRAINT "membership_role" CHECK ("memberships"."role" in ('owner','editor','viewer'))
);
--> statement-breakpoint
CREATE TABLE "merchants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	CONSTRAINT "merchants_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"price_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"checkout_url" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "offers_merchant_id_id_unique" UNIQUE("merchant_id","id"),
	CONSTRAINT "offers_connection_id_external_id_unique" UNIQUE("connection_id","external_id"),
	CONSTRAINT "offer_price_safe" CHECK ("offers"."price_minor" >= 0 and "offers"."price_minor" <= 9007199254740991),
	CONSTRAINT "offer_currency" CHECK ("offers"."currency" = 'TRY')
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"external_key" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"category" text NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "products_merchant_id_id_unique" UNIQUE("merchant_id","id"),
	CONSTRAINT "products_connection_id_external_key_unique" UNIQUE("connection_id","external_key")
);
--> statement-breakpoint
CREATE TABLE "variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"size" text NOT NULL,
	"color" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "variants_merchant_id_id_unique" UNIQUE("merchant_id","id"),
	CONSTRAINT "variants_connection_id_external_id_unique" UNIQUE("connection_id","external_id")
);
--> statement-breakpoint
ALTER TABLE "source_connections" ADD CONSTRAINT "source_connections_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_merchant_id_connection_id_source_connections_merchant_id_id_fk" FOREIGN KEY ("merchant_id","connection_id") REFERENCES "public"."source_connections"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_merchant_id_offer_id_offers_merchant_id_id_fk" FOREIGN KEY ("merchant_id","offer_id") REFERENCES "public"."offers"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_merchant_id_variant_id_variants_merchant_id_id_fk" FOREIGN KEY ("merchant_id","variant_id") REFERENCES "public"."variants"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_merchant_id_connection_id_source_connections_merchant_id_id_fk" FOREIGN KEY ("merchant_id","connection_id") REFERENCES "public"."source_connections"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_merchant_id_connection_id_source_connections_merchant_id_id_fk" FOREIGN KEY ("merchant_id","connection_id") REFERENCES "public"."source_connections"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variants" ADD CONSTRAINT "variants_merchant_id_product_id_products_merchant_id_id_fk" FOREIGN KEY ("merchant_id","product_id") REFERENCES "public"."products"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variants" ADD CONSTRAINT "variants_merchant_id_connection_id_source_connections_merchant_id_id_fk" FOREIGN KEY ("merchant_id","connection_id") REFERENCES "public"."source_connections"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "products_public_category" ON "products" USING btree ("published","category");