-- ÜRÜN-008: WooCommerce secure pairing lifecycle. Adds plugin pairing state,
-- connection audit and normalized store identity columns. This migration is
-- additive; production application is intentionally outside this task.

ALTER TABLE "source_connections" ADD COLUMN "store_url" text;
--> statement-breakpoint
ALTER TABLE "source_connections" ADD COLUMN "store_name" text;
--> statement-breakpoint
ALTER TABLE "source_connections" ADD COLUMN "connected_via" text DEFAULT 'dashboard_credentials' NOT NULL;
--> statement-breakpoint
ALTER TABLE "source_connections"
ADD CONSTRAINT "connection_connected_via"
CHECK ("connected_via" in ('dashboard_credentials','plugin_pairing'));
--> statement-breakpoint
-- One merchant owns one active connection per normalized store URL; a second
-- merchant pairing the same store must produce an explicit conflict.
CREATE UNIQUE INDEX "source_connections_active_store_unique"
ON "source_connections" ("provider", "store_url")
WHERE "active" = true
  AND "authorization_status" in ('pending','active','reauthorization_required')
  AND "store_url" IS NOT NULL;
--> statement-breakpoint
CREATE TABLE "connection_pairings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "merchant_id" uuid NOT NULL,
  "provider" text NOT NULL,
  "created_by" uuid NOT NULL,
  -- SHA-256 of the raw pairing token; the plaintext token is never stored.
  "token_hash" text NOT NULL UNIQUE,
  "store_url" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "expires_at" timestamptz NOT NULL,
  "consumed_at" timestamptz,
  "consumed_connection_id" uuid,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "connection_pairings_merchant_id_merchants_id_fk"
    FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id")
    ON DELETE restrict ON UPDATE cascade,
  CONSTRAINT "connection_pairings_created_by_users_id_fk"
    FOREIGN KEY ("created_by") REFERENCES "public"."users"("id")
    ON DELETE restrict ON UPDATE cascade,
  CONSTRAINT "connection_pairings_consumed_connection_fk"
    FOREIGN KEY ("merchant_id", "consumed_connection_id")
    REFERENCES "public"."source_connections"("merchant_id", "id")
    ON DELETE restrict ON UPDATE cascade,
  CONSTRAINT "connection_pairing_provider"
    CHECK ("provider" in ('woocommerce')),
  CONSTRAINT "connection_pairing_status"
    CHECK ("status" in ('pending','consumed','expired','rejected'))
);
--> statement-breakpoint
CREATE INDEX "connection_pairings_merchant_created"
ON "connection_pairings" ("merchant_id", "created_at");
--> statement-breakpoint
CREATE TABLE "connection_audit" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "merchant_id" uuid NOT NULL,
  -- Nullable: pairing events precede the connection they create.
  "connection_id" uuid,
  "provider" text,
  "event" text NOT NULL,
  "actor" text NOT NULL,
  "result" text NOT NULL,
  "detail" jsonb,
  "correlation_id" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "connection_audit_merchant_connection_fk"
    FOREIGN KEY ("merchant_id", "connection_id")
    REFERENCES "public"."source_connections"("merchant_id", "id")
    ON DELETE restrict ON UPDATE cascade,
  CONSTRAINT "connection_audit_event"
    CHECK ("event" in ('pairing_created','pairing_consumed','pairing_rejected','connection_created','validation_failed','connection_reconnected','connection_secret_rotated','connection_revoked')),
  CONSTRAINT "connection_audit_result"
    CHECK ("result" in ('success','failure'))
);
--> statement-breakpoint
CREATE INDEX "connection_audit_merchant_created"
ON "connection_audit" ("merchant_id", "created_at");
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "connection_pairings" TO "shopai_app";
--> statement-breakpoint
GRANT SELECT, INSERT ON "connection_audit" TO "shopai_app";
--> statement-breakpoint
REVOKE ALL ON "connection_pairings" FROM "shopai_public", "shopai_worker";
--> statement-breakpoint
REVOKE ALL ON "connection_audit" FROM "shopai_public", "shopai_worker";
--> statement-breakpoint
ALTER TABLE "connection_pairings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "connection_pairings" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "connection_audit" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "connection_audit" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_connection_pairings"
ON "connection_pairings" FOR ALL TO "shopai_app"
USING ("merchant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
WITH CHECK ("merchant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "tenant_connection_audit"
ON "connection_audit" FOR ALL TO "shopai_app"
USING ("merchant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
WITH CHECK ("merchant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
