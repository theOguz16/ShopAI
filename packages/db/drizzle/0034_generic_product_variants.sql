-- Additive product descriptors and purchasable variant options. Existing
-- source identities, price/stock offers and legacy size/color stay intact.
ALTER TABLE products ADD COLUMN source_category_id text;
--> statement-breakpoint
ALTER TABLE products ADD COLUMN source_category_path jsonb;
--> statement-breakpoint
ALTER TABLE products ADD COLUMN descriptive_attributes jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint
ALTER TABLE variants ADD COLUMN options jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint
ALTER TABLE variants ADD COLUMN image_url text;
--> statement-breakpoint
ALTER TABLE variants ADD COLUMN image_alt text;
--> statement-breakpoint
UPDATE variants SET options = jsonb_strip_nulls(jsonb_build_array(
  CASE WHEN size <> 'ONE_SIZE' THEN jsonb_build_object('key', 'size', 'value', size) END,
  CASE WHEN color <> 'unspecified' THEN jsonb_build_object('key', 'color', 'value', color) END
)) WHERE options = '[]'::jsonb;
--> statement-breakpoint
UPDATE variants SET options = (SELECT coalesce(jsonb_agg(item), '[]'::jsonb) FROM jsonb_array_elements(options) AS item WHERE item <> 'null'::jsonb);
--> statement-breakpoint
ALTER TABLE products ADD CONSTRAINT products_descriptive_attributes_array CHECK (jsonb_typeof(descriptive_attributes) = 'array');
--> statement-breakpoint
ALTER TABLE variants ADD CONSTRAINT variants_options_array CHECK (jsonb_typeof(options) = 'array');
--> statement-breakpoint
ALTER TABLE products ADD CONSTRAINT products_source_category_path_array CHECK (source_category_path IS NULL OR jsonb_typeof(source_category_path) = 'array');
