import { DEMO_MERCHANT_ID } from '@shopai/commerce';
import { eq } from 'drizzle-orm';
import { createDatabase } from './client.js';
import { inventory } from './schema.js';

if (process.env.DEPLOY_ENV !== 'staging')
  throw new Error('Demo inventory refresh yalnız staging ortamında çalışır.');

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL gerekli.');

const database = createDatabase(url, {
  applicationName: 'shopai-staging-demo-refresh',
});

try {
  const rows = await database.db
    .update(inventory)
    .set({ fetchedAt: new Date() })
    .where(eq(inventory.merchantId, DEMO_MERCHANT_ID))
    .returning({ offerId: inventory.offerId });

  if (rows.length === 0)
    throw new Error('Demo merchant için inventory satırı bulunamadı.');

  console.info(`Demo staging inventory yenilendi: ${rows.length} offer.`);
} finally {
  await database.close();
}
