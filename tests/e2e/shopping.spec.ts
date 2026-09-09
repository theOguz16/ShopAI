import { expect, test } from '@playwright/test';
import { pilot } from './pilot-env.js';

test('finds the exact variant on web and redirects to the approved store', async ({
  page,
  request,
}) => {
  await page.goto(pilot.webUrl);
  await page.getByLabel('İhtiyacın').fill(pilot.productTitle);
  await page.getByLabel('Beden').selectOption(pilot.size);
  await page.getByRole('button', { name: 'Ürünleri bul' }).click();
  const product = page
    .getByRole('article')
    .filter({ hasText: pilot.productTitle })
    .first();
  await expect(product).toContainText(`${pilot.size} beden`);
  await expect(product).toContainText(pilot.color);
  await expect(product).toContainText(
    new Intl.NumberFormat('tr-TR', {
      style: 'currency',
      currency: 'TRY',
    }).format(pilot.priceMinor / 100),
  );
  await expect(product).not.toContainText('Sentetik');
  const redirectPath = await product
    .getByRole('link', { name: /Mağazada kontrol et/u })
    .getAttribute('href');
  expect(redirectPath).toMatch(/^https?:\/\/[^/]+\/r\//u);
  if (!redirectPath) throw new Error('Ürün yönlendirme bağlantısı bulunamadı.');
  const response = await request.get(redirectPath, { maxRedirects: 0 });
  expect(response.status()).toBe(302);
  expect(new URL(response.headers().location ?? '').origin).toBe(
    pilot.checkoutUrl.origin,
  );
});

test('returns the same constrained product through MCP for ChatGPT', async ({
  request,
}) => {
  const response = await request.post(`${pilot.apiUrl}/mcp`, {
    headers: { accept: 'application/json, text/event-stream' },
    data: {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'search_products',
        arguments: {
          query: pilot.productTitle,
          filters: { sizes: [pilot.size] },
        },
      },
    },
  });
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  const item = body.result.structuredContent.items.find(
    (candidate: { title: string; size: string }) =>
      candidate.title === pilot.productTitle && candidate.size === pilot.size,
  );
  expect(item).toBeTruthy();
  expect(item.priceMinor).toBe(pilot.priceMinor);
  expect(item.color).toBe(pilot.color);
});
