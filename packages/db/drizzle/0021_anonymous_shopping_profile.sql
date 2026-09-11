CREATE TABLE "anonymous_shopping_profiles" (
  "anonymous_user_id" uuid PRIMARY KEY NOT NULL,
  "preferred_sizes" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "preferred_colors" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "preferred_styles" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "preferred_price_ranges" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "anonymous_profile_preferred_sizes_object" CHECK (jsonb_typeof("anonymous_shopping_profiles"."preferred_sizes") = 'object'),
  CONSTRAINT "anonymous_profile_preferred_colors_object" CHECK (jsonb_typeof("anonymous_shopping_profiles"."preferred_colors") = 'object'),
  CONSTRAINT "anonymous_profile_preferred_styles_object" CHECK (jsonb_typeof("anonymous_shopping_profiles"."preferred_styles") = 'object'),
  CONSTRAINT "anonymous_profile_preferred_price_ranges_object" CHECK (jsonb_typeof("anonymous_shopping_profiles"."preferred_price_ranges") = 'object')
);
--> statement-breakpoint
ALTER TABLE "anonymous_shopping_profiles" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "anonymous_shopping_profiles" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON "anonymous_shopping_profiles" FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON "anonymous_shopping_profiles" FROM shopai_app, shopai_worker;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "anonymous_shopping_profiles" TO shopai_public;
--> statement-breakpoint
CREATE POLICY "anonymous_shopping_profiles_select_own"
ON "anonymous_shopping_profiles"
FOR SELECT
TO shopai_public
USING (
  "anonymous_user_id" = nullif(current_setting('app.anonymous_user_id', true), '')::uuid
);
--> statement-breakpoint
CREATE POLICY "anonymous_shopping_profiles_insert_own"
ON "anonymous_shopping_profiles"
FOR INSERT
TO shopai_public
WITH CHECK (
  "anonymous_user_id" = nullif(current_setting('app.anonymous_user_id', true), '')::uuid
);
--> statement-breakpoint
CREATE POLICY "anonymous_shopping_profiles_update_own"
ON "anonymous_shopping_profiles"
FOR UPDATE
TO shopai_public
USING (
  "anonymous_user_id" = nullif(current_setting('app.anonymous_user_id', true), '')::uuid
)
WITH CHECK (
  "anonymous_user_id" = nullif(current_setting('app.anonymous_user_id', true), '')::uuid
);
