import { expect, test, type Page, type Route } from '@playwright/test';

type SearchBody = {
  query: string;
  filters?: { sizes?: string[] };
  cursor?: string | null;
};

const ids = {
  search: '11111111-1111-4111-8111-111111111111',
  product: '22222222-2222-4222-8222-222222222222',
  variant: '33333333-3333-4333-8333-333333333333',
  offer: '44444444-4444-4444-8444-444444444444',
  merchant: '55555555-5555-4555-8555-555555555555',
};

function response(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    searchId: ids.search,
    items: [
      {
        productId: ids.product,
        variantId: ids.variant,
        offerId: ids.offer,
        merchantId: ids.merchant,
        merchantName: 'Örnek Butik',
        title: 'Keten Dokulu Tişört',
        description: 'Mock pilot kataloğu ürünü',
        category: 'tshirt',
        imageUrl: null,
        imageAlt: null,
        size: 'M',
        color: 'black',
        priceMinor: 129900,
        currency: 'TRY',
        available: true,
        stockStatus: 'in_stock',
        priceSource: 'demo-fixture',
        stockSource: 'demo-fixture',
        priceObservedAt: null,
        stockObservedAt: null,
        observedAt: '2026-09-09T09:00:00.000Z',
        checkoutUrl: 'https://example.com/demo-product',
      },
    ],
    nextCursor: null,
    facets: {
      categories: [{ value: 'tshirt', count: 1 }],
      sizes: [
        { value: 'S', count: 1 },
        { value: 'M', count: 1 },
      ],
      colors: [{ value: 'black', count: 1 }],
    },
    appliedFilters: {
      category: 'tshirt',
      sizes: ['M'],
      colors: ['black'],
      excludedSizes: [],
      excludedColors: [],
      excludedCategories: [],
      maxPriceMinor: 150000,
      currency: 'TRY',
      inStockOnly: true,
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
      fallback: true,
    },
    mode: 'demo',
    ...overrides,
  };
}

async function mockSearch(
  page: Page,
  handler?: (route: Route, body: SearchBody) => Promise<void>,
) {
  await page.route('**/v1/search', async (route) => {
    const body = route.request().postDataJSON() as SearchBody;
    if (handler) return handler(route, body);
    await route.fulfill({ json: response() });
  });
}

test('mock katalogda mobil arama, filtre düzeltme ve ürün inceleme akışı', async ({
  page,
}) => {
  const requests: SearchBody[] = [];
  await page.setViewportSize({ width: 360, height: 800 });
  await mockSearch(page, async (route, body) => {
    requests.push(body);
    const sizes = body.filters?.sizes;
    await route.fulfill({
      json: response({
        appliedFilters: {
          ...response().appliedFilters,
          sizes: sizes ?? ['M'],
        },
      }),
    });
  });
  await page.goto('/');

  await page.getByLabel('Beden').selectOption('S');
  await page.getByRole('button', { name: 'Ürünleri bul' }).click();
  await expect(page.getByText('Demo katalog', { exact: true })).toBeVisible();
  await expect(page.getByText('Demo ürün', { exact: true })).toBeVisible();
  await expect(page.getByLabel('S beden filtresini kaldır')).toBeVisible();
  expect(requests[0].filters.sizes).toEqual(['S']);

  await page.getByLabel('S beden filtresini kaldır').click();
  expect(requests[1].filters.sizes).toEqual([]);
  await expect(page.getByLabel('S beden filtresini kaldır')).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expect(
    page.getByRole('link', { name: 'Örnek sayfayı incele' }),
  ).toBeVisible();
});

test('boş sonuç filtreleri gevşetmez ve ağ hatası yeniden denenebilir', async ({
  page,
}) => {
  let attempt = 0;
  await mockSearch(page, async (route) => {
    attempt += 1;
    if (attempt === 1) return route.abort('failed');
    await route.fulfill({ json: response({ items: [] }) });
  });
  await page.goto('/');
  await page.getByLabel('Nasıl bir ürün arıyorsun?').press('Enter');
  await expect(page.locator('section.error-state')).toContainText(
    'ürünleri getiremiyoruz',
  );
  await page.getByRole('button', { name: 'Yeniden dene' }).click();
  await expect(
    page.getByText('Bu koşullara uyan ürün bulamadık.'),
  ).toBeVisible();
  await expect(
    page.getByText('Filtrelerini senin yerine gevşetmedik.'),
  ).toBeVisible();
  expect(attempt).toBe(2);
});

test('eski sayfalama yanıtı yeni filtre sonuçlarına eklenmez', async ({
  page,
}) => {
  const newSearchId = '66666666-6666-4666-8666-666666666666';
  let requestCount = 0;
  await mockSearch(page, async (route, body) => {
    requestCount += 1;
    if (body.cursor) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      await route
        .fulfill({
          json: response({
            items: [{ ...response().items[0], title: 'Eski sayfa ürünü' }],
          }),
        })
        .catch(() => undefined);
      return;
    }
    if (requestCount === 1) {
      await route.fulfill({ json: response({ nextCursor: 'page-2' }) });
      return;
    }
    await route.fulfill({
      json: response({
        searchId: newSearchId,
        items: [{ ...response().items[0], title: 'Yeni filtre sonucu' }],
        appliedFilters: { ...response().appliedFilters, sizes: ['S'] },
      }),
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Ürünleri bul' }).click();
  await page.getByRole('button', { name: 'Daha fazla ürün göster' }).click();
  await page.getByRole('button', { name: 'S 1' }).click();

  await expect(page.getByText('Yeni filtre sonucu')).toBeVisible();
  await expect(page.getByText('Eski sayfa ürünü')).toHaveCount(0);
});
