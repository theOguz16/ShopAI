import { expect, test } from '@playwright/test';
import { pilot } from './pilot-env.js';

async function login(page: import('@playwright/test').Page) {
  await page.goto(`${pilot.webUrl}/login`);
  await page.getByLabel('E-posta').fill(pilot.email);
  await page.getByLabel('Pilot kodu').fill(pilot.loginToken);
  await page.getByRole('button', { name: 'Giriş yap' }).click();
  await expect(page).toHaveURL(/\/dashboard/u);
  await expect(
    page.getByRole('heading', {
      name: /Mağazanı yayına hazırla|Mağazanızı kurun|Mağaza seçin/u,
    }),
  ).toBeVisible();
  if (
    await page.getByRole('heading', { name: 'Mağazanızı kurun' }).isVisible()
  ) {
    await page.getByLabel('Mağaza adı').fill(`Pilot ${Date.now()}`);
    await page.getByRole('button', { name: 'Mağazayı oluştur' }).click();
    await expect(
      page.getByRole('heading', { name: 'Mağazanı yayına hazırla' }),
    ).toBeVisible();
  }
  if (await page.getByRole('heading', { name: 'Mağaza seçin' }).isVisible()) {
    await page.getByLabel('Mağaza').selectOption({ index: 1 });
    await expect(
      page.getByRole('heading', { name: 'Mağazanı yayına hazırla' }),
    ).toBeVisible();
  }
}

const csvCell = (value: string | number) =>
  `"${String(value).replaceAll('"', '""')}"`;

test.describe
  .serial('merchant onboarding acceptance', () => {
    test('logs in, uploads a permitted catalog and publishes its draft', async ({
      page,
    }) => {
      await login(page);

      const forbiddenStatus = await page.evaluate(async (apiUrl) => {
        const response = await fetch(
          `${apiUrl}/v1/merchants/f0000000-0000-4000-8000-000000000001/products`,
          { credentials: 'include' },
        );
        return response.status;
      }, pilot.apiUrl);
      expect(forbiddenStatus).toBe(403);

      await page.goto(`${pilot.webUrl}/dashboard/imports`);
      const csv = [
        'external_id,product_key,title,description,category,size,color,price_minor,currency,available,checkout_url',
        [
          pilot.externalId,
          `pilot-${pilot.externalId}`,
          pilot.productTitle,
          'İzinli pilot kabul kaydı',
          'pilot',
          pilot.size,
          pilot.color,
          pilot.priceMinor,
          'TRY',
          'true',
          pilot.checkoutUrl.href,
        ]
          .map(csvCell)
          .join(','),
      ].join('\n');
      await page.locator('input[type=file]').setInputFiles({
        name: 'pilot-acceptance.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(csv),
      });
      await page.getByRole('button', { name: 'Dosyayı yükle' }).click();
      await expect(page.getByRole('status')).toContainText('kontrol ediliyor');

      await expect
        .poll(async () => page.getByRole('listitem').allTextContents(), {
          timeout: 60_000,
        })
        .toEqual(
          expect.arrayContaining([expect.stringContaining('Tamamlandı')]),
        );

      await page.goto(`${pilot.webUrl}/dashboard/products`);
      const product = page
        .getByRole('listitem')
        .filter({ hasText: pilot.productTitle })
        .first();
      await expect(product).toContainText('Taslak');
      await product.getByRole('button', { name: 'Yayımla' }).click();
      await expect(page.getByRole('status')).toContainText('yayımlandı');
      await expect(product).toContainText('Yayında');
    });

    test('leaves a recoverable message for a rejected catalog', async ({
      page,
    }) => {
      await login(page);
      await page.goto(`${pilot.webUrl}/dashboard/imports`);
      await page.locator('input[type=file]').setInputFiles({
        name: 'invalid.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from('external_id,title\nbroken,Eksik ürün'),
      });
      await page.getByRole('button', { name: 'Dosyayı yükle' }).click();
      await expect(page.getByRole('status')).toContainText('kontrol ediliyor');
      await expect
        .poll(async () => page.getByText(/Satır \d+/u).allTextContents(), {
          timeout: 60_000,
        })
        .not.toHaveLength(0);
      await expect(
        page.getByRole('button', { name: 'Dosyayı yükle' }),
      ).toBeVisible();
    });
  });
