import { expect, test } from '@playwright/test';

const storeA = '10000000-0000-4000-8000-000000000001';
const storeB = '20000000-0000-4000-8000-000000000001';

function searchResponse(items: unknown[]) {
  return {
    schemaVersion: 1,
    searchId: '30000000-0000-4000-8000-000000000001',
    items,
    nextCursor: null,
    facets: { categories: [], sizes: [], colors: [] },
    appliedFilters: {
      sizes: [],
      colors: [],
      excludedSizes: [],
      excludedColors: [],
      excludedCategories: [],
      currency: 'TRY',
      inStockOnly: false,
    },
    warnings: [],
    telemetry: {
      provider: 'fixture',
      model: 'fixture',
      promptVersion: 'fixture',
      latencyMs: 1,
      estimatedCostUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      fallback: false,
    },
    mode: 'postgres',
  };
}

const item = {
  productId: '40000000-0000-4000-8000-000000000001',
  variantId: '50000000-0000-4000-8000-000000000001',
  offerId: '60000000-0000-4000-8000-000000000001',
  merchantId: storeA,
  merchantName: 'Butik A',
  title: 'A Mağazası Tişörtü',
  description: '',
  category: 'tshirt',
  imageUrl: null,
  imageAlt: null,
  size: 'M',
  color: 'black',
  priceMinor: 129900,
  currency: 'TRY',
  available: true,
  stockStatus: 'in_stock',
  priceSource: 'catalog-import',
  stockSource: 'catalog-import',
  priceObservedAt: null,
  stockObservedAt: null,
  observedAt: '2026-09-09T09:00:00.000Z',
  checkoutUrl: 'https://example.com/r/offer-a',
};

test('mağaza sayfası oturumsuz ve mobil çalışır, yalnız kendi ürününü gösterir', async ({
  page,
}) => {
  let searchBody: Record<string, unknown> = {};
  await page.setViewportSize({ width: 360, height: 800 });
  await page.route('**/v1/stores/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/v1/stores/butik-a')
      return route.fulfill({
        json: { store: { id: storeA, name: 'Butik A', slug: 'butik-a' } },
      });
    if (pathname === `/v1/stores/${storeA}/search`) {
      searchBody = route.request().postDataJSON();
      return route.fulfill({ json: searchResponse([item]) });
    }
    return route.fulfill({ status: 404, json: { code: 'STORE_NOT_FOUND' } });
  });
  await page.goto('/stores/butik-a');
  await expect(
    page.getByRole('heading', { name: 'Ne arıyorsun?' }),
  ).toBeVisible();
  await expect(page.getByText('A Mağazası Tişörtü')).toBeVisible();
  await expect(page.getByText('B Mağazası Ürünü')).toHaveCount(0);
  expect(searchBody).not.toHaveProperty('merchantIds');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test('var olmayan mağaza ve boş katalog açıklanır', async ({ page }) => {
  await page.route('**/v1/stores/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/v1/stores/bos-butik')
      return route.fulfill({
        json: { store: { id: storeB, name: 'Boş Butik', slug: 'bos-butik' } },
      });
    if (pathname.endsWith('/search'))
      return route.fulfill({ json: searchResponse([]) });
    return route.fulfill({ status: 404, json: { code: 'STORE_NOT_FOUND' } });
  });
  await page.goto('/stores/bos-butik');
  await expect(
    page.getByText('Bu mağazada henüz yayımlanmış ürün yok.'),
  ).toBeVisible();
  await page.goto('/stores/yok-butik');
  await expect(page.getByText('Bu mağazayı bulamadık.')).toBeVisible();
});
