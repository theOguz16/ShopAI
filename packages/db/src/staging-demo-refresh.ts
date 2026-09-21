import { DEMO_MERCHANT_ID } from '@shopai/commerce';
import { eq } from 'drizzle-orm';
import { createDatabase } from './client.js';
import { inventory, products } from './schema.js';

if (process.env.DEPLOY_ENV !== 'staging')
  throw new Error('Demo inventory refresh yalnız staging ortamında çalışır.');

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL gerekli.');
const widgetOrigin = process.env.WIDGET_ORIGIN;
if (!widgetOrigin) throw new Error('WIDGET_ORIGIN gerekli.');

const demoImages = [
  {
    productId: '20000000-0000-4000-8000-000000000001',
    path: 'black-tshirt.svg',
    alt: 'Sentetik siyah tişört demo illüstrasyonu',
  },
  {
    productId: '20000000-0000-4000-8000-000000000003',
    path: 'white-tshirt.svg',
    alt: 'Sentetik beyaz tişört demo illüstrasyonu',
  },
  {
    productId: '20000000-0000-4000-8000-000000000004',
    path: 'navy-tshirt.svg',
    alt: 'Sentetik lacivert tişört demo illüstrasyonu',
  },
] as const;

const database = createDatabase(url, {
  applicationName: 'shopai-staging-demo-refresh',
});

try {
  for (const image of demoImages) {
    await database.db
      .update(products)
      .set({
        imageUrl: `${widgetOrigin}/demo-products/${image.path}`,
        imageAlt: image.alt,
      })
      .where(eq(products.id, image.productId));
  }
  const rows = await database.db
    .update(inventory)
    .set({ fetchedAt: new Date() })
    .where(eq(inventory.merchantId, DEMO_MERCHANT_ID))
    .returning({ offerId: inventory.offerId });

  if (rows.length === 0)
    throw new Error('Demo merchant için inventory satırı bulunamadı.');

  console.info(
    `Demo staging inventory yenilendi: ${rows.length} offer; ${demoImages.length} sentetik görsel eşlendi.`,
  );
} finally {
  await database.close();
}
