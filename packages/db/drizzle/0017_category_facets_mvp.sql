CREATE TABLE "categories" (
  "slug" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "category_facets" (
  "category_slug" text NOT NULL,
  "facet_key" text NOT NULL,
  "label" text NOT NULL,
  "options" jsonb NOT NULL,
  "position" integer DEFAULT 0 NOT NULL,
  CONSTRAINT "category_facets_category_slug_categories_slug_fk" FOREIGN KEY ("category_slug") REFERENCES "public"."categories"("slug") ON DELETE cascade,
  CONSTRAINT "category_facets_category_slug_facet_key_unique" UNIQUE("category_slug","facet_key")
);
--> statement-breakpoint
CREATE TABLE "product_attributes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "merchant_id" uuid NOT NULL,
  "product_id" uuid NOT NULL,
  "facet_key" text NOT NULL,
  "value" text NOT NULL,
  CONSTRAINT "product_attributes_product_id_facet_key_value_unique" UNIQUE("product_id","facet_key","value"),
  CONSTRAINT "product_attributes_merchant_id_product_id_products_merchant_id_id_fk" FOREIGN KEY ("merchant_id","product_id") REFERENCES "public"."products"("merchant_id","id") ON DELETE cascade
);
--> statement-breakpoint
GRANT SELECT ON categories, category_facets TO shopai_app, shopai_worker, shopai_public;
GRANT SELECT, INSERT, UPDATE, DELETE ON product_attributes TO shopai_app, shopai_worker;
GRANT SELECT ON product_attributes TO shopai_public;
--> statement-breakpoint
ALTER TABLE product_attributes ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_attributes FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_product_attributes ON product_attributes FOR ALL TO shopai_app, shopai_worker
  USING (merchant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (merchant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY public_product_attributes ON product_attributes FOR SELECT TO shopai_public USING (
  EXISTS (
    SELECT 1 FROM products p
    WHERE p.id = product_id
      AND p.merchant_id = product_attributes.merchant_id
      AND p.published = true
  )
);
--> statement-breakpoint
INSERT INTO "categories" ("slug", "name") VALUES
  ('tshirt', 'T-Shirt'),
  ('fishing-rod', 'Fishing Rod')
ON CONFLICT ("slug") DO NOTHING;
--> statement-breakpoint
INSERT INTO "category_facets" ("category_slug", "facet_key", "label", "options", "position") VALUES
  ('tshirt', 'size', 'Size', '["S","M","L","XL"]'::jsonb, 10),
  ('tshirt', 'color', 'Color', '["black","white","navy","gray"]'::jsonb, 20),
  ('tshirt', 'fit', 'Fit', '["slim","regular","oversized"]'::jsonb, 30),
  ('tshirt', 'sleeve', 'Sleeve', '["short","long"]'::jsonb, 40),
  ('fishing-rod', 'length', 'Length', '["1.80 m","2.10 m","2.40 m","2.70 m"]'::jsonb, 10),
  ('fishing-rod', 'action', 'Action', '["slow","moderate","fast"]'::jsonb, 20),
  ('fishing-rod', 'casting_weight', 'Casting weight', '["5-20 g","10-30 g","20-60 g"]'::jsonb, 30)
ON CONFLICT ("category_slug", "facet_key") DO NOTHING;
