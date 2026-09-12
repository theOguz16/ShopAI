CREATE TABLE "product_alerts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "merchant_id" uuid NOT NULL,
  "user_id" uuid,
  "anonymous_user_id" uuid,
  "product_id" uuid NOT NULL,
  "variant_id" uuid,
  "condition_type" text NOT NULL,
  "target_value" bigint,
  "status" text DEFAULT 'ACTIVE' NOT NULL,
  "channel" text DEFAULT 'email' NOT NULL,
  "delivery_email" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "triggered_at" timestamp with time zone,
  CONSTRAINT "product_alerts_merchant_id_merchants_id_fk"
    FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id")
    ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "product_alerts_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
    ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "product_alerts_identity_exactly_one" CHECK (
    ("user_id" IS NOT NULL AND "anonymous_user_id" IS NULL)
    OR
    ("user_id" IS NULL AND "anonymous_user_id" IS NOT NULL)
  ),
  CONSTRAINT "product_alerts_condition_type" CHECK (
    "condition_type" IN ('PRICE_BELOW', 'BACK_IN_STOCK')
  ),
  CONSTRAINT "product_alerts_status" CHECK (
    "status" IN ('ACTIVE', 'TRIGGERED', 'CANCELLED')
  ),
  CONSTRAINT "product_alerts_channel" CHECK ("channel" = 'email'),
  CONSTRAINT "product_alerts_condition_shape" CHECK (
    ("condition_type" = 'PRICE_BELOW' AND "target_value" IS NOT NULL AND "target_value" > 0)
    OR
    ("condition_type" = 'BACK_IN_STOCK' AND "target_value" IS NULL AND "variant_id" IS NOT NULL)
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX "product_alerts_active_identity_condition_unique"
ON "product_alerts" (
  coalesce("user_id", "anonymous_user_id"),
  "product_id",
  coalesce("variant_id", '00000000-0000-0000-0000-000000000000'::uuid),
  "condition_type",
  coalesce("target_value", -1)
)
WHERE "status" = 'ACTIVE';
--> statement-breakpoint
CREATE INDEX "product_alerts_merchant_product_status"
ON "product_alerts" ("merchant_id", "product_id", "status");
--> statement-breakpoint
CREATE INDEX "product_alerts_user_created"
ON "product_alerts" ("user_id", "created_at");
--> statement-breakpoint
CREATE INDEX "product_alerts_anonymous_created"
ON "product_alerts" ("anonymous_user_id", "created_at");
--> statement-breakpoint
CREATE TABLE "product_alert_notifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "merchant_id" uuid NOT NULL,
  "alert_id" uuid NOT NULL,
  "channel" text DEFAULT 'email' NOT NULL,
  "recipient" text NOT NULL,
  "subject" text NOT NULL,
  "body" text NOT NULL,
  "status" text DEFAULT 'PENDING' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "claimed_at" timestamp with time zone,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "sent_at" timestamp with time zone,
  CONSTRAINT "product_alert_notifications_merchant_id_merchants_id_fk"
    FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id")
    ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "product_alert_notifications_alert_id_product_alerts_id_fk"
    FOREIGN KEY ("alert_id") REFERENCES "public"."product_alerts"("id")
    ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "product_alert_notifications_channel" CHECK ("channel" = 'email'),
  CONSTRAINT "product_alert_notifications_status" CHECK (
    "status" IN ('PENDING', 'SENDING', 'SENT')
  ),
  CONSTRAINT "product_alert_notifications_state_shape" CHECK (
    ("status" = 'PENDING' AND "claimed_at" IS NULL AND "sent_at" IS NULL)
    OR
    ("status" = 'SENDING' AND "claimed_at" IS NOT NULL AND "sent_at" IS NULL)
    OR
    ("status" = 'SENT' AND "claimed_at" IS NOT NULL AND "sent_at" IS NOT NULL)
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX "product_alert_notifications_alert_unique"
ON "product_alert_notifications" ("alert_id");
--> statement-breakpoint
CREATE INDEX "product_alert_notifications_pending"
ON "product_alert_notifications" ("merchant_id", "status", "claimed_at", "created_at");
--> statement-breakpoint
ALTER TABLE "product_alerts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "product_alerts" FORCE ROW LEVEL SECURITY;
ALTER TABLE "product_alert_notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "product_alert_notifications" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON "product_alerts", "product_alert_notifications" FROM PUBLIC;
REVOKE ALL ON "product_alerts", "product_alert_notifications" FROM shopai_app;
REVOKE ALL ON "product_alert_notifications" FROM shopai_public;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "product_alerts" TO shopai_public;
GRANT SELECT, UPDATE ON "product_alerts" TO shopai_worker;
GRANT SELECT, INSERT, UPDATE ON "product_alert_notifications" TO shopai_worker;
--> statement-breakpoint
CREATE POLICY "product_alerts_select_own"
ON "product_alerts"
FOR SELECT TO shopai_public
USING (
  ("user_id" IS NOT NULL AND "user_id" = nullif(current_setting('app.user_id', true), '')::uuid)
  OR
  ("anonymous_user_id" IS NOT NULL AND "anonymous_user_id" = nullif(current_setting('app.anonymous_user_id', true), '')::uuid)
);
--> statement-breakpoint
CREATE POLICY "product_alerts_insert_own"
ON "product_alerts"
FOR INSERT TO shopai_public
WITH CHECK (
  (
    ("user_id" IS NOT NULL AND "user_id" = nullif(current_setting('app.user_id', true), '')::uuid AND "anonymous_user_id" IS NULL)
    OR
    ("anonymous_user_id" IS NOT NULL AND "anonymous_user_id" = nullif(current_setting('app.anonymous_user_id', true), '')::uuid AND "user_id" IS NULL)
  )
  AND EXISTS (
    SELECT 1
    FROM products p
    JOIN merchants m ON m.id = p.merchant_id
    WHERE p.id = product_id
      AND p.merchant_id = merchant_id
      AND p.published = true
      AND m.active = true
      AND m.is_public = true
  )
);
--> statement-breakpoint
CREATE POLICY "product_alerts_update_own"
ON "product_alerts"
FOR UPDATE TO shopai_public
USING (
  ("user_id" IS NOT NULL AND "user_id" = nullif(current_setting('app.user_id', true), '')::uuid)
  OR
  ("anonymous_user_id" IS NOT NULL AND "anonymous_user_id" = nullif(current_setting('app.anonymous_user_id', true), '')::uuid)
)
WITH CHECK (
  ("user_id" IS NOT NULL AND "user_id" = nullif(current_setting('app.user_id', true), '')::uuid)
  OR
  ("anonymous_user_id" IS NOT NULL AND "anonymous_user_id" = nullif(current_setting('app.anonymous_user_id', true), '')::uuid)
);
--> statement-breakpoint
CREATE POLICY "product_alerts_worker_tenant"
ON "product_alerts"
FOR ALL TO shopai_worker
USING ("merchant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
WITH CHECK ("merchant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "product_alert_notifications_worker_tenant"
ON "product_alert_notifications"
FOR ALL TO shopai_worker
USING ("merchant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
WITH CHECK ("merchant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
