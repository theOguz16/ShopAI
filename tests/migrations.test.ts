import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('database migrations', () => {
  it('casts legacy membership user ids explicitly when switching to uuid', async () => {
    const migration = await readFile(
      new URL(
        '../packages/db/drizzle/0002_graceful_bloodscream.sql',
        import.meta.url,
      ),
      'utf8',
    );

    expect(migration).toContain(
      'ALTER COLUMN "user_id" SET DATA TYPE uuid USING "user_id"::uuid',
    );
  });

  it('creates the import run composite unique constraint before its foreign key', async () => {
    const migration = await readFile(
      new URL(
        '../packages/db/drizzle/0004_cute_radioactive_man.sql',
        import.meta.url,
      ),
      'utf8',
    );
    const uniqueConstraint = migration.indexOf(
      'CONSTRAINT "import_runs_merchant_id_id_unique" UNIQUE("merchant_id","id")',
    );
    const foreignKey = migration.indexOf(
      'REFERENCES "public"."import_runs"("merchant_id","id")',
    );

    expect(uniqueConstraint).toBeGreaterThanOrEqual(0);
    expect(foreignKey).toBeGreaterThan(uniqueConstraint);
  });

  it('hardens outbox access to tenant and worker roles', async () => {
    const migration = await readFile(
      new URL(
        '../packages/db/drizzle/0009_tenant_route_hardening.sql',
        import.meta.url,
      ),
      'utf8',
    );

    expect(migration).toContain(
      'ALTER TABLE import_outbox_events FORCE ROW LEVEL SECURITY',
    );
    expect(migration).toContain('CREATE POLICY tenant_outbox_insert');
    expect(migration).toContain('CREATE POLICY tenant_outbox_select');
    expect(migration).toContain('CREATE POLICY worker_outbox_select');
    expect(migration).toContain('ALTER ROLE shopai_app NOINHERIT');
    expect(migration).toContain(
      'GRANT shopai_public TO shopai_app, shopai_worker WITH INHERIT FALSE, SET TRUE',
    );
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION shopai_bootstrap_merchant',
    );
  });

  it('backfills legacy channels into separate transport and surface columns', async () => {
    const migration = await readFile(
      new URL(
        '../packages/db/drizzle/0013_surface_transport.sql',
        import.meta.url,
      ),
      'utf8',
    );

    expect(migration).toContain(
      "CASE WHEN \"channel\" = 'mcp' THEN 'mcp' ELSE 'rest' END",
    );
    expect(migration).toContain(
      "CASE WHEN \"channel\" = 'mcp' THEN 'chatgpt' ELSE 'web' END",
    );
    expect(migration).toContain(
      'ALTER TABLE "search_events" ALTER COLUMN "transport" SET NOT NULL',
    );
    expect(migration).toContain(
      'ALTER TABLE "search_events" ALTER COLUMN "surface" SET NOT NULL',
    );
    expect(migration).toContain(
      'conversion."search_id" = attribution."search_id"',
    );
  });

  it('creates discovery sessions and links search and redirect events', async () => {
    const migration = await readFile(
      new URL(
        '../packages/db/drizzle/0014_discovery_sessions.sql',
        import.meta.url,
      ),
      'utf8',
    );

    expect(migration).toContain('CREATE TABLE "discovery_sessions"');
    expect(migration).toContain(
      '"merchant_scope" jsonb DEFAULT \'[]\'::jsonb NOT NULL',
    );
    expect(migration).toContain(
      'ALTER TABLE "search_events" ADD COLUMN "discovery_session_id" uuid',
    );
    expect(migration).toContain(
      'ALTER TABLE "redirect_clicks" ADD COLUMN "discovery_session_id" uuid',
    );
    expect(migration).toContain(
      'REFERENCES "public"."discovery_sessions"("id")',
    );
  });

  it('adds branded storefront identity without publishing merchants by default', async () => {
    const migration = await readFile(
      new URL(
        '../packages/db/drizzle/0015_branded_storefront_context.sql',
        import.meta.url,
      ),
      'utf8',
    );

    expect(migration).toContain('ADD COLUMN "display_name" text');
    expect(migration).toContain('ADD COLUMN "logo_url" text');
    expect(migration).toContain('ADD COLUMN "cover_image_url" text');
    expect(migration).toContain(
      'ADD COLUMN "primary_color" text DEFAULT \'#111111\' NOT NULL',
    );
    expect(migration).toContain(
      'ADD COLUMN "is_public" boolean DEFAULT false NOT NULL',
    );
    expect(migration).toContain(
      'UPDATE "merchants" SET "display_name" = "name"',
    );
  });

  it('persists tenant-scoped connector sync progress without public access', async () => {
    const migration = await readFile(
      new URL(
        '../packages/db/drizzle/0016_catalog_sync_progress.sql',
        import.meta.url,
      ),
      'utf8',
    );

    expect(migration).toContain('CREATE TABLE "connection_sync_progress"');
    expect(migration).toContain(
      "CHECK (\"status\" in ('queued','running','completed','partial','failed'))",
    );
    expect(migration).toContain(
      'REFERENCES "public"."source_connections"("merchant_id", "id")',
    );
    expect(migration).toContain(
      'REVOKE ALL ON "connection_sync_progress" FROM shopai_public',
    );
    expect(migration).toContain(
      'ALTER TABLE "connection_sync_progress" FORCE ROW LEVEL SECURITY',
    );
    expect(migration).toContain(
      'CREATE POLICY tenant_connection_sync_progress',
    );
  });

  it('backfills product and campaign checkout attribution before enforcing product integrity', async () => {
    const migration = await readFile(
      new URL(
        '../packages/db/drizzle/0018_checkout_click_attribution.sql',
        import.meta.url,
      ),
      'utf8',
    );

    const productBackfill = migration.indexOf(
      'SET "product_id" = variant."product_id"',
    );
    const notNull = migration.indexOf('ALTER COLUMN "product_id" SET NOT NULL');
    expect(productBackfill).toBeGreaterThanOrEqual(0);
    expect(notNull).toBeGreaterThan(productBackfill);
    expect(migration).toContain('SET "campaign" = session."campaign"');
    expect(migration).toContain('redirect_clicks_campaign_reporting');
    expect(migration).toContain('v.product_id = redirect_clicks.product_id');
    expect(migration).toContain('AND m.active = true');
    expect(migration).toContain('AND m.is_public = true');
  });
});
