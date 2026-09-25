-- ÜRÜN-007: durable bounded-memory sync checkpoints and run-scoped offer
-- visibility. Additive only; production application is intentionally outside
-- this task.

CREATE TABLE "sync_run_checkpoints" (
  "merchant_id" uuid NOT NULL,
  "connection_id" uuid NOT NULL,
  "sync_run_id" uuid NOT NULL,
  "status" text DEFAULT 'running' NOT NULL,
  "cursor" text,
  "pages" bigint DEFAULT 0 NOT NULL,
  "chunks" bigint DEFAULT 0 NOT NULL,
  "rows_processed" bigint DEFAULT 0 NOT NULL,
  "products_processed" bigint DEFAULT 0 NOT NULL,
  "variants_processed" bigint DEFAULT 0 NOT NULL,
  "rejected_rows" bigint DEFAULT 0 NOT NULL,
  "attempts" bigint DEFAULT 1 NOT NULL,
  "source_complete" boolean DEFAULT false NOT NULL,
  "observed_at" timestamp with time zone NOT NULL,
  "max_source_observed_at" timestamp with time zone,
  "started_at" timestamp with time zone NOT NULL,
  "completed_at" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "sync_run_checkpoints_pk" PRIMARY KEY ("merchant_id","connection_id","sync_run_id"),
  CONSTRAINT "sync_run_checkpoints_connection_fk" FOREIGN KEY ("merchant_id","connection_id")
    REFERENCES "public"."source_connections"("merchant_id","id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "sync_run_checkpoints_status" CHECK ("status" in ('running','completed','failed')),
  CONSTRAINT "sync_run_checkpoints_counts" CHECK (
    "pages" >= 0 AND "chunks" >= 0 AND "rows_processed" >= 0
    AND "products_processed" >= 0 AND "variants_processed" >= 0
    AND "rejected_rows" >= 0 AND "attempts" >= 0
  )
);
--> statement-breakpoint
CREATE INDEX "sync_run_checkpoints_connection_status"
  ON "sync_run_checkpoints" USING btree ("connection_id", "status", "updated_at");
--> statement-breakpoint
-- The stored cursor is opaque provider paging state and carries no secret
-- material; the table is still tenant-scoped and hidden from the public role.
GRANT SELECT, INSERT, UPDATE, DELETE ON "sync_run_checkpoints" TO shopai_app, shopai_worker;
REVOKE ALL ON "sync_run_checkpoints" FROM shopai_public;
--> statement-breakpoint
ALTER TABLE "sync_run_checkpoints" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sync_run_checkpoints" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_sync_run_checkpoints ON "sync_run_checkpoints"
  FOR ALL TO shopai_app, shopai_worker
  USING (merchant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (merchant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
-- Full syncs deactivate offers the run did not observe; the stamp makes that
-- decision exact without materializing the catalog in memory.
ALTER TABLE "offers" ADD COLUMN "last_sync_run_id" uuid;
--> statement-breakpoint
CREATE INDEX "offers_connection_last_sync_run"
  ON "offers" USING btree ("connection_id", "last_sync_run_id");
