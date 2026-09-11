CREATE TABLE "saved_products" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid,
  "anonymous_user_id" uuid,
  "product_id" uuid NOT NULL,
  "variant_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "saved_products_identity_exactly_one" CHECK (
    ("user_id" IS NOT NULL AND "anonymous_user_id" IS NULL)
    OR
    ("user_id" IS NULL AND "anonymous_user_id" IS NOT NULL)
  ),
  CONSTRAINT "saved_products_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
    ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX "saved_products_identity_product_variant_unique"
ON "saved_products" (
  coalesce("user_id", "anonymous_user_id"),
  "product_id",
  coalesce("variant_id", '00000000-0000-0000-0000-000000000000'::uuid)
);
--> statement-breakpoint
CREATE INDEX "saved_products_user_created"
ON "saved_products" ("user_id", "created_at");
--> statement-breakpoint
CREATE INDEX "saved_products_anonymous_created"
ON "saved_products" ("anonymous_user_id", "created_at");
--> statement-breakpoint
ALTER TABLE "saved_products" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "saved_products" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON "saved_products" FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON "saved_products" FROM shopai_app, shopai_worker;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "saved_products" TO shopai_public;
--> statement-breakpoint
CREATE POLICY "saved_products_select_own"
ON "saved_products"
FOR SELECT
TO shopai_public
USING (
  (
    "user_id" IS NOT NULL
    AND "user_id" = nullif(current_setting('app.user_id', true), '')::uuid
  )
  OR
  (
    "anonymous_user_id" IS NOT NULL
    AND "anonymous_user_id" = nullif(current_setting('app.anonymous_user_id', true), '')::uuid
  )
);
--> statement-breakpoint
CREATE POLICY "saved_products_insert_own"
ON "saved_products"
FOR INSERT
TO shopai_public
WITH CHECK (
  (
    "user_id" IS NOT NULL
    AND "user_id" = nullif(current_setting('app.user_id', true), '')::uuid
    AND "anonymous_user_id" IS NULL
  )
  OR
  (
    "anonymous_user_id" IS NOT NULL
    AND "anonymous_user_id" = nullif(current_setting('app.anonymous_user_id', true), '')::uuid
    AND "user_id" IS NULL
  )
);
--> statement-breakpoint
CREATE POLICY "saved_products_delete_own"
ON "saved_products"
FOR DELETE
TO shopai_public
USING (
  (
    "user_id" IS NOT NULL
    AND "user_id" = nullif(current_setting('app.user_id', true), '')::uuid
  )
  OR
  (
    "anonymous_user_id" IS NOT NULL
    AND "anonymous_user_id" = nullif(current_setting('app.anonymous_user_id', true), '')::uuid
  )
);
