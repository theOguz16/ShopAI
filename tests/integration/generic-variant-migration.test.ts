import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createDatabase } from '../../packages/db/src/client.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL gerekli.');
const database = createDatabase(databaseUrl);
const migration = readFileSync(
  new URL(
    '../../packages/db/drizzle/0034_generic_product_variants.sql',
    import.meta.url,
  ),
  'utf8',
);

afterAll(async () => database.close());

describe('generic variant additive migration', () => {
  it('backfills only real legacy size/color values and keeps source strings', async () => {
    await database.db.transaction(async (tx) => {
      await tx.execute(sql`create schema urun005_migration_test`);
      await tx.execute(sql`set local search_path to urun005_migration_test`);
      await tx.execute(sql`create table products (id text primary key)`);
      await tx.execute(
        sql`create table variants (id text primary key, size text not null, color text not null)`,
      );
      await tx.execute(
        sql`insert into variants (id, size, color) values ('apparel', 'XL', 'Siyah'), ('generic', 'ONE_SIZE', 'unspecified'), ('size-only', '42 EU', 'unspecified')`,
      );
      for (const statement of migration.split('--> statement-breakpoint')) {
        if (statement.trim()) await tx.execute(sql.raw(statement));
      }
      const result = await tx.execute(
        sql`select id, options from variants order by id`,
      );
      expect(result.rows).toEqual([
        {
          id: 'apparel',
          options: [
            { key: 'size', value: 'XL' },
            { key: 'color', value: 'Siyah' },
          ],
        },
        { id: 'generic', options: [] },
        { id: 'size-only', options: [{ key: 'size', value: '42 EU' }] },
      ]);
      await tx.execute(sql`drop schema urun005_migration_test cascade`);
    });
  });
});
