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

  it('keeps migrations ordered after anonymous shopping profile', async () => {
    const journal = JSON.parse(
      await readFile(
        new URL('../packages/db/drizzle/meta/_journal.json', import.meta.url),
        'utf8',
      ),
    ) as { entries: Array<{ idx: number; tag: string }> };
    expect(journal.entries.slice(-4)).toEqual([
      expect.objectContaining({
        idx: 18,
        tag: '0019_merchant_conversion_callback',
      }),
      expect.objectContaining({ idx: 19, tag: '0020_product_view_events' }),
      expect.objectContaining({
        idx: 20,
        tag: '0021_anonymous_shopping_profile',
      }),
      expect.objectContaining({ idx: 21, tag: '0022_saved_products' }),
    ]);
  });
});
