import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  DEMO_CONNECTION_ID,
  DEMO_MERCHANT_ID,
  demoRecords,
} from '@shopai/commerce';
import { and, eq, inArray } from 'drizzle-orm';
import { createDatabase, type Database } from './client.js';
import { importCatalog } from './import-catalog.js';
import { connections, merchants, products } from './schema.js';
import { setTenantContext } from './tenant-context.js';
export async function seedDemo(db: Database) {
  await db
    .insert(merchants)
    .values({
      id: DEMO_MERCHANT_ID,
      name: 'Demo Mağaza',
      slug: 'demo',
      active: true,
    })
    .onConflictDoNothing();
  await db
    .insert(connections)
    .values({
      id: DEMO_CONNECTION_ID,
      merchantId: DEMO_MERCHANT_ID,
      provider: 'csv',
    })
    .onConflictDoNothing();
  await importCatalog(db, {
    schemaVersion: 1,
    runId: randomUUID(),
    observedAt: new Date().toISOString(),
    merchantId: DEMO_MERCHANT_ID,
    connectionId: DEMO_CONNECTION_ID,
    rows: demoRecords.map((r) => ({
      externalId: r.variantId,
      productKey: r.productId,
      title: r.title,
      description: r.description,
      category: r.category,
      size: r.size,
      color: r.color,
      priceMinor: r.priceMinor,
      currency: r.currency,
      available: r.available,
      checkoutUrl: r.checkoutUrl,
    })),
  });
  // Only the synthetic local seed is explicitly published. CSV imports remain drafts.
  const syntheticProductKeys = [
    ...new Set(demoRecords.map((r) => r.productId)),
  ];
  await db.transaction(async (tx) => {
    await setTenantContext(tx, DEMO_MERCHANT_ID);
    await tx
      .update(products)
      .set({ published: true })
      .where(
        and(
          eq(products.merchantId, DEMO_MERCHANT_ID),
          eq(products.connectionId, DEMO_CONNECTION_ID),
          inArray(products.externalKey, syntheticProductKeys),
        ),
      );
  });
  console.info('Yerel sentetik katalog hazır.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const url = process.env.DATABASE_URL;
  if (!url || !['localhost', '127.0.0.1'].includes(new URL(url).hostname))
    throw new Error('Demo seed yalnız yerel DATABASE_URL ile çalışır.');
  const database = createDatabase(url);
  try {
    await seedDemo(database.db);
  } finally {
    await database.close();
  }
}
