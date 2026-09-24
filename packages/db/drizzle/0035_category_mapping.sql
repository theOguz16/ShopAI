-- ÜRÜN-006: preserve source categories and map them into a separate,
-- tenant-scoped canonical ShopAI category tree. This migration is additive;
-- production application is intentionally outside this task.
ALTER TABLE "products" ADD COLUMN "source_category_name" text;
--> statement-breakpoint
UPDATE "products"
SET "source_category_name" = "category"
WHERE "source_category_name" IS NULL;
--> statement-breakpoint
CREATE INDEX "products_source_category"
ON "products" ("merchant_id", "connection_id", "source_category_id");
--> statement-breakpoint

ALTER TABLE "categories" ADD COLUMN "parent_slug" text;
--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "active" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "categories"
ADD CONSTRAINT "categories_parent_slug_categories_slug_fk"
FOREIGN KEY ("parent_slug") REFERENCES "public"."categories"("slug")
ON DELETE restrict;
--> statement-breakpoint
CREATE INDEX "categories_parent_active"
ON "categories" ("parent_slug", "active");
--> statement-breakpoint

ALTER TABLE "category_facets"
ADD COLUMN "attribute_scope" text DEFAULT 'variant' NOT NULL;
--> statement-breakpoint
ALTER TABLE "category_facets" ADD COLUMN "attribute_key" text;
--> statement-breakpoint
ALTER TABLE "category_facets" ADD COLUMN "unit" text;
--> statement-breakpoint
ALTER TABLE "category_facets" ADD COLUMN "active" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
UPDATE "category_facets" SET "attribute_key" = "facet_key"
WHERE "attribute_key" IS NULL;
--> statement-breakpoint
ALTER TABLE "category_facets" ALTER COLUMN "attribute_key" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "category_facets"
ADD CONSTRAINT "category_facets_attribute_scope_check"
CHECK ("attribute_scope" in ('product','variant'));
--> statement-breakpoint

INSERT INTO "categories" ("slug", "name", "parent_slug", "active") VALUES
  ('apparel', 'Giyim', NULL, true),
  ('fishing', 'Balıkçılık', NULL, true),
  ('sports', 'Spor', NULL, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "active" = true;
--> statement-breakpoint
UPDATE "categories"
SET "name" = 'Tişört', "parent_slug" = 'apparel', "active" = true
WHERE "slug" = 'tshirt';
--> statement-breakpoint
UPDATE "categories"
SET "name" = 'Olta', "parent_slug" = 'fishing', "active" = true
WHERE "slug" = 'fishing-rod';
--> statement-breakpoint

UPDATE "category_facets"
SET "attribute_scope" = 'variant', "attribute_key" = "facet_key"
WHERE "category_slug" IN ('tshirt', 'fishing-rod');
--> statement-breakpoint
UPDATE "category_facets"
SET "unit" = 'cm'
WHERE "category_slug" = 'fishing-rod' AND "facet_key" = 'length';
--> statement-breakpoint
INSERT INTO "category_facets"
  ("category_slug","facet_key","label","options","position",
   "attribute_scope","attribute_key","unit","active")
VALUES
  ('tshirt','material','Malzeme','[]'::jsonb,30,'product','material',NULL,true),
  ('fishing-rod','power','Güç','[]'::jsonb,30,'variant','power',NULL,true),
  ('sports','capacity','Kapasite','[]'::jsonb,10,'variant','capacity','ml',true),
  ('sports','size','Beden / ölçü','[]'::jsonb,20,'variant','size',NULL,true),
  ('sports','number','Numara','[]'::jsonb,30,'variant','number',NULL,true),
  ('sports','weight','Ağırlık','[]'::jsonb,40,'variant','weight',NULL,true)
ON CONFLICT ("category_slug","facet_key") DO UPDATE SET
  "label" = EXCLUDED."label",
  "position" = EXCLUDED."position",
  "attribute_scope" = EXCLUDED."attribute_scope",
  "attribute_key" = EXCLUDED."attribute_key",
  "unit" = EXCLUDED."unit",
  "active" = EXCLUDED."active";
--> statement-breakpoint

CREATE TABLE "source_category_mappings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "merchant_id" uuid NOT NULL,
  "connection_id" uuid NOT NULL,
  "provider" text NOT NULL,
  "source_category_id" text NOT NULL,
  "source_category_name" text NOT NULL,
  "source_category_path" jsonb,
  "canonical_category_slug" text,
  "status" text DEFAULT 'needs_mapping' NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_by" uuid,
  CONSTRAINT "source_category_mappings_scope_unique"
    UNIQUE("merchant_id","connection_id","provider","source_category_id"),
  CONSTRAINT "source_category_mappings_connection_fk"
    FOREIGN KEY ("merchant_id","connection_id")
    REFERENCES "public"."source_connections"("merchant_id","id")
    ON DELETE cascade,
  CONSTRAINT "source_category_mappings_canonical_fk"
    FOREIGN KEY ("canonical_category_slug")
    REFERENCES "public"."categories"("slug"),
  CONSTRAINT "source_category_mappings_updated_by_fk"
    FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id"),
  CONSTRAINT "source_category_mappings_status_check"
    CHECK ("status" in ('mapped','needs_mapping')),
  CONSTRAINT "source_category_mappings_target_check"
    CHECK (
      ("status" = 'mapped' AND "canonical_category_slug" IS NOT NULL)
      OR
      ("status" = 'needs_mapping' AND "canonical_category_slug" IS NULL)
    ),
  CONSTRAINT "source_category_mappings_path_array_check"
    CHECK (
      "source_category_path" IS NULL
      OR jsonb_typeof("source_category_path") = 'array'
    )
);
--> statement-breakpoint
CREATE INDEX "source_category_mappings_status"
ON "source_category_mappings" ("merchant_id", "status");
--> statement-breakpoint
CREATE INDEX "source_category_mappings_canonical"
ON "source_category_mappings" ("canonical_category_slug", "status");
--> statement-breakpoint

INSERT INTO "source_category_mappings"
  ("merchant_id","connection_id","provider","source_category_id",
   "source_category_name","source_category_path","status")
SELECT DISTINCT ON (
  p."merchant_id", p."connection_id", c."provider", p."source_category_id"
)
  p."merchant_id",
  p."connection_id",
  c."provider",
  p."source_category_id",
  COALESCE(p."source_category_name", p."category"),
  p."source_category_path",
  'needs_mapping'
FROM "products" p
JOIN "source_connections" c
  ON c."id" = p."connection_id"
 AND c."merchant_id" = p."merchant_id"
WHERE p."source_category_id" IS NOT NULL
ORDER BY
  p."merchant_id",
  p."connection_id",
  c."provider",
  p."source_category_id",
  p."observed_at" DESC;
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE
ON "source_category_mappings" TO shopai_app, shopai_worker;
--> statement-breakpoint
GRANT SELECT (
  "merchant_id","connection_id","provider","source_category_id",
  "canonical_category_slug","status"
) ON "source_category_mappings" TO shopai_public;
--> statement-breakpoint
ALTER TABLE "source_category_mappings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "source_category_mappings" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_source_category_mappings"
ON "source_category_mappings" FOR ALL TO shopai_app, shopai_worker
USING (
  "merchant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid
)
WITH CHECK (
  "merchant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid
);
--> statement-breakpoint
CREATE POLICY "public_source_category_mappings"
ON "source_category_mappings" FOR SELECT TO shopai_public
USING (
  "status" = 'mapped'
  AND EXISTS (
    SELECT 1 FROM "merchants" m
    WHERE m."id" = "source_category_mappings"."merchant_id"
      AND m."active" = true
      AND m."is_public" = true
  )
);
