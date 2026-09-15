import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('saved products migration', () => {
  it('keeps shopper identity isolated without coupling history to live catalog rows', async () => {
    const migration = await readFile(
      new URL(
        '../packages/db/drizzle/0022_saved_products.sql',
        import.meta.url,
      ),
      'utf8',
    );

    expect(migration).toContain('CREATE TABLE "saved_products"');
    expect(migration).toContain('saved_products_identity_exactly_one');
    expect(migration).toContain(
      'saved_products_identity_product_variant_unique',
    );
    expect(migration).toContain(
      'ALTER TABLE "saved_products" FORCE ROW LEVEL SECURITY',
    );
    expect(migration).toContain(
      'REVOKE ALL ON "saved_products" FROM shopai_app, shopai_worker',
    );
    expect(migration).toContain("current_setting('app.user_id', true)");
    expect(migration).toContain(
      "current_setting('app.anonymous_user_id', true)",
    );
    expect(migration).not.toContain('REFERENCES "public"."products"');
    expect(migration).not.toContain('REFERENCES "public"."variants"');
  });

  it('keeps shopper and later migrations in chronological order', async () => {
    const journal = JSON.parse(
      await readFile(
        new URL('../packages/db/drizzle/meta/_journal.json', import.meta.url),
        'utf8',
      ),
    ) as { entries: Array<{ idx: number; tag: string }> };
    const expectedTags = [
      '0020_product_view_events',
      '0021_anonymous_shopping_profile',
      '0022_saved_products',
      '0023_product_alerts',
      '0024_source_sync_watermark',
      '0025_public_visibility_rls',
      '0026_search_intent_metrics',
    ];
    const positions = expectedTags.map((tag) =>
      journal.entries.findIndex((entry) => entry.tag === tag),
    );
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });
});
