CREATE TABLE "connection_sync_progress" (
  "connection_id" uuid PRIMARY KEY NOT NULL,
  "merchant_id" uuid NOT NULL,
  "status" text DEFAULT 'queued' NOT NULL,
  "found_products" integer DEFAULT 0 NOT NULL,
  "processed_products" integer DEFAULT 0 NOT NULL,
  "failed_products" integer DEFAULT 0 NOT NULL,
  "variants" integer DEFAULT 0 NOT NULL,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "error" text,
  CONSTRAINT "connection_sync_progress_status" CHECK ("status" in ('queued','running','completed','partial','failed')),
  CONSTRAINT "connection_sync_progress_counts" CHECK (
    "found_products" >= 0 AND
    "processed_products" >= 0 AND
    "failed_products" >= 0 AND
    "variants" >= 0 AND
    "processed_products" + "failed_products" <= "found_products"
  )
);
--> statement-breakpoint
ALTER TABLE "connection_sync_progress"
  ADD CONSTRAINT "connection_sync_progress_connection_fk"
  FOREIGN KEY ("merchant_id", "connection_id")
  REFERENCES "public"."source_connections"("merchant_id", "id")
  ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint
CREATE INDEX "connection_sync_progress_merchant_updated"
  ON "connection_sync_progress" USING btree ("merchant_id", "updated_at");
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "connection_sync_progress" TO shopai_app, shopai_worker;
REVOKE ALL ON "connection_sync_progress" FROM shopai_public;
--> statement-breakpoint
ALTER TABLE "connection_sync_progress" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "connection_sync_progress" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_connection_sync_progress ON "connection_sync_progress"
  FOR ALL TO shopai_app, shopai_worker
  USING (merchant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (merchant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
