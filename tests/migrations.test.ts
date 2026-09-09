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
});
