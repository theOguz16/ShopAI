import { expect, test } from '@playwright/test';
import path from 'node:path';

const merchantId = '10000000-0000-4000-8000-000000000001';
const productId = '20000000-0000-4000-8000-000000000001';

test('örnek CSV ile aktarım tamamlanır ve ilk ürün yayımlanır', async ({
  page,
}) => {
  let importReads = 0;
  let uploadedBody = '';
  let published = false;
  await page.route('**/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (url.pathname === '/v1/auth/session')
      return route.fulfill({ json: { user: { userId: 'pilot-user' } } });
    if (url.pathname === '/v1/merchants')
      return route.fulfill({
        json: {
          merchants: [
            {
              id: merchantId,
              name: 'Örnek Butik',
              slug: 'ornek-butik',
              role: 'owner',
            },
          ],
        },
      });
    if (url.pathname.endsWith('/connections') && method === 'GET')
      return route.fulfill({
        json: [
          {
            id: 'connection-1',
            provider: 'csv',
            authorizationStatus: 'active',
            syncMode: 'full',
            lastSuccessfulSyncAt: null,
            lastFetchedAt: null,
            lastSyncError: null,
            conversionTrackingEnabled: false,
          },
        ],
      });
    if (url.pathname.endsWith('/credential-refs'))
      return route.fulfill({ json: { credentialRefs: [] } });
    if (url.pathname.endsWith('/imports') && method === 'POST') {
      uploadedBody = route.request().postData() ?? '';
      return route.fulfill({
        status: 202,
        json: { runId: 'run-1', status: 'pending' },
      });
    }
    if (url.pathname.endsWith('/imports')) {
      importReads += 1;
      return route.fulfill({
        json:
          importReads < 3
            ? [{ id: 'run-1', status: 'pending', rows: 0 }]
            : [{ id: 'run-1', status: 'completed', rows: 1 }],
      });
    }
    if (url.pathname.endsWith('/products/publication') && method === 'POST') {
      published = true;
      return route.fulfill({ json: { id: productId, published: true } });
    }
    if (url.pathname.endsWith('/products'))
      return route.fulfill({
        json: [
          {
            id: productId,
            title: 'Keten Dokulu Tişört',
            description: 'Örnek ürün',
            category: 'tshirt',
            imageUrl: null,
            imageAlt: null,
            published,
            publicationChangedAt: null,
            variants: [
              {
                id: 'variant-1',
                size: 'M',
                color: 'black',
                offer: {
                  priceMinor: 129900,
                  currency: 'TRY',
                  checkoutUrl: 'https://magaza.example.com/urun/ornek-tisort',
                  observedAt: '2026-09-09T09:00:00.000Z',
                  inventory: {
                    available: true,
                    stockStatus: 'in_stock',
                    observedAt: '2026-09-09T09:00:00.000Z',
                  },
                },
              },
            ],
          },
        ],
      });
    return route.fulfill({ status: 404, json: {} });
  });

  await page.goto('/dashboard/imports');
  await page
    .locator('input[type=file]')
    .setInputFiles(
      path.resolve('apps/web/public/examples/catalog-template.csv'),
    );
  await page.getByRole('button', { name: 'Dosyayı yükle' }).click();
  await expect(page.getByText('Tamamlandı')).toBeVisible({ timeout: 8_000 });
  expect(uploadedBody).toContain('ornek-tisort-siyah-m');
  await page.screenshot({
    path: path.resolve('docs/evidence/t06-onboarding-import.png'),
    fullPage: true,
  });
  await page.getByRole('link', { name: 'Ürünleri kontrol et' }).click();
  const product = page
    .getByRole('listitem')
    .filter({ hasText: 'Keten Dokulu Tişört' })
    .first();
  await product.getByRole('button', { name: 'Yayımla' }).click();
  await expect(product).toContainText('Yayında');
});

test('viewer düzenleme kontrollerini görmez ve teknik secret referansı gösterilmez', async ({
  page,
}) => {
  await page.route('**/v1/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/v1/auth/session')
      return route.fulfill({ json: { user: { userId: 'viewer' } } });
    if (pathname === '/v1/merchants')
      return route.fulfill({
        json: {
          merchants: [
            {
              id: merchantId,
              name: 'Salt Okunur Butik',
              slug: 'viewer',
              role: 'viewer',
            },
          ],
        },
      });
    if (pathname.endsWith('/credential-refs'))
      return route.fulfill({
        json: {
          credentialRefs: [
            {
              provider: 'woocommerce',
              credentialsRef: 'secret://WC_PILOT_STORE',
            },
          ],
        },
      });
    if (pathname.endsWith('/connections')) return route.fulfill({ json: [] });
    if (pathname.endsWith('/products') || pathname.endsWith('/imports'))
      return route.fulfill({ json: [] });
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto('/dashboard/connections');
  await expect(page.getByText('Görüntüleyici yetkin var.')).toBeVisible();
  await expect(page.getByText('secret://WC_PILOT_STORE')).toHaveCount(0);
  await expect(
    page.getByRole('option', { name: 'WooCommerce bağlantısı 1' }),
  ).toBeAttached();
  await expect(
    page.getByRole('button', { name: /bağlantısını ekle|hazırla/u }),
  ).toHaveCount(0);
});

test('mağaza değişince eski mağazanın geciken import sonucu yazılmaz', async ({
  page,
}) => {
  const secondMerchantId = '10000000-0000-4000-8000-000000000002';
  await page.route('**/v1/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/v1/auth/session')
      return route.fulfill({ json: { user: { userId: 'multi-store-user' } } });
    if (pathname === '/v1/merchants')
      return route.fulfill({
        json: {
          merchants: [
            {
              id: merchantId,
              name: 'Birinci Butik',
              slug: 'birinci',
              role: 'owner',
            },
            {
              id: secondMerchantId,
              name: 'İkinci Butik',
              slug: 'ikinci',
              role: 'owner',
            },
          ],
        },
      });
    if (pathname === `/v1/merchants/${merchantId}/imports`) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      return route
        .fulfill({ json: [{ id: 'old-run', status: 'completed', rows: 99 }] })
        .catch(() => undefined);
    }
    if (pathname === `/v1/merchants/${secondMerchantId}/imports`)
      return route.fulfill({
        json: [{ id: 'new-run', status: 'failed', rows: 2 }],
      });
    return route.fulfill({ json: [] });
  });
  await page.goto('/dashboard/imports');
  await page.getByLabel('Mağaza').selectOption(merchantId);
  await expect(page.getByLabel('Aktif mağaza')).toBeVisible();
  await page.getByLabel('Aktif mağaza').selectOption(secondMerchantId);
  await expect(page.getByText('Düzeltme gerekiyor')).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.getByText('99 satır')).toHaveCount(0);
});
