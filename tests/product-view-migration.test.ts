import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('product view analytics migration', () => {
  it('creates tenant-scoped product view events with public write eligibility', async () => {
    const migration = await readFile(
      new URL(
        '../packages/db/drizzle/0020_product_view_events.sql',
        import.meta.url,
      ),
      'utf8',
    );

    expect(migration).toContain('CREATE TABLE "product_view_events"');
    expect(migration).toContain('GRANT INSERT ON product_view_events TO shopai_public');
    expect(migration).toContain('GRANT SELECT ON product_view_events TO shopai_app');
    expect(migration).toContain('ALTER TABLE product_view_events FORCE ROW LEVEL SECURITY');
    expect(migration).toContain('CREATE POLICY public_product_view_events_insert');
    expect(migration).toContain('CREATE POLICY tenant_product_view_events_select');
    expect(migration).toContain('AND p.published = true');
    expect(migration).toContain('AND m.active = true');
    expect(migration).toContain('AND m.is_public = true');
    expect(migration).toContain('product_view_events_reporting');
    expect(migration).toContain('product_view_events_surface_reporting');
  });
});
