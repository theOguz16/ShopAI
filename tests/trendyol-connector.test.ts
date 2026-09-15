import { describe, expect, it, vi } from 'vitest';
import {
  ConnectorHttpError,
  createLiveCatalogConnector,
  TrendyolConnector,
} from '../packages/connectors/src/index.js';

const credentials = {
  sellerId: '2748',
  apiKey: 'key_test_value',
  apiSecret: 'credential_test_value',
  environment: 'stage' as const,
  integrationName: 'ShopAI',
};

function content(variantId = 70228905, quantity = 7) {
  return {
    contentId: 12715815,
    productMainId: '12613876842A60',
    category: { id: 91266, name: 'Tişört' },
    lastModifiedDate: 1760938781669,
    title: 'Açık Gri Tişört',
    description: '<p>Pamuklu ürün</p>',
    images: [{ url: '/mediacenter-stage3/catalog/1.jpg' }],
    attributes: [{ attributeName: 'Renk', attributeValue: 'Siyah' }],
    variants: [
      {
        variantId,
        barcode: String(variantId),
        attributes: [{ attributeName: 'Beden', attributeValue: 'M' }],
        productUrl:
          'https://stage.trendyol.com/abc/xyz-p-12715815?merchantId=2748',
        onSale: true,
        stock: { quantity, lastModifiedDate: 1774948958844 },
        price: {
          salePrice: 222,
          listPrice: 249,
          priceSeenByCustomer: 169,
        },
        sellerModifiedDate: 1761041127000,
        locked: false,
        archived: false,
        blacklisted: false,
      },
    ],
  };
}

function response(input: {
  page: number;
  totalPages: number;
  nextPageToken?: string | null;
  body?: ReturnType<typeof content>[];
}) {
  return new Response(
    JSON.stringify({
      totalElements: input.totalPages * 100,
      totalPages: input.totalPages,
      page: input.page,
      size: 100,
      nextPageToken: input.nextPageToken ?? null,
      content: input.body ?? [content(input.page + 1)],
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

describe('Trendyol Product V2 connector', () => {
  it('maps variants, stock, customer price and incremental watermark', async () => {
    const calls: Array<{ url: URL; init?: RequestInit }> = [];
    const fetcher = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      calls.push({ url: new URL(String(input)), init });
      return response({ page: 0, totalPages: 1, body: [content()] });
    });
    const connector = new TrendyolConnector(
      credentials,
      fetcher as typeof fetch,
      async () => undefined,
      3,
      () => Date.parse('2026-09-15T12:00:00.000Z'),
      0,
    );

    const page = await connector.readPage({
      mode: 'incremental',
      modifiedAfter: '2026-09-01T00:00:00.000Z',
    });

    expect(page.complete).toBe(true);
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0]).toMatchObject({
      externalId: '70228905',
      productKey: '12613876842A60',
      title: 'Açık Gri Tişört',
      description: 'Pamuklu ürün',
      category: 'Tişört',
      imageUrl: 'https://stage.trendyol.com/mediacenter-stage3/catalog/1.jpg',
      size: 'M',
      color: 'Siyah',
      priceMinor: 16900,
      currency: 'TRY',
      available: true,
      checkoutUrl:
        'https://stage.trendyol.com/abc/xyz-p-12715815?merchantId=2748',
    });
    expect(calls[0]?.url.pathname).toBe(
      '/integration/product/sellers/2748/products/approved',
    );
    expect(calls[0]?.url.searchParams.get('startDate')).toBe(
      String(Date.parse('2026-09-01T00:00:00.000Z')),
    );
    expect(calls[0]?.url.searchParams.get('dateQueryType')).toBe(
      'VARIANT_MODIFIED_DATE',
    );
    expect(calls[0]?.init?.headers).toMatchObject({
      'user-agent': '2748 - ShopAI',
      accept: 'application/json',
    });
  });

  it('switches from numbered pages to nextPageToken beyond 10k and resumes', async () => {
    const calls: URL[] = [];
    const fetcher = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      calls.push(url);
      if (url.searchParams.get('nextPageToken') === 'after-10000')
        return response({ page: 100, totalPages: 101, body: [content(10101)] });
      const page = Number(url.searchParams.get('page') ?? 0);
      return response({
        page,
        totalPages: 101,
        nextPageToken: page === 99 ? 'after-10000' : `token-${page}`,
        body: [content(page * 100 + 1)],
      });
    });
    const connector = new TrendyolConnector(
      credentials,
      fetcher as typeof fetch,
      async () => undefined,
      3,
      () => Date.parse('2026-09-15T12:00:00.000Z'),
      0,
    );

    const boundary = await connector.readPage({
      mode: 'full',
      cursor: 'page:99',
    });
    expect(boundary.nextCursor).toBe('token:after-10000');

    const resumed = await connector.readPage({
      mode: 'full',
      cursor: boundary.nextCursor,
    });
    expect(resumed.complete).toBe(true);
    expect(resumed.nextCursor).toBeNull();
    expect(calls[1]?.searchParams.get('nextPageToken')).toBe('after-10000');
    expect(calls[1]?.searchParams.has('page')).toBe(false);
  });

  it('fails closed if a >10k catalog does not return nextPageToken', async () => {
    const fetcher = vi.fn(async () =>
      response({ page: 99, totalPages: 101, nextPageToken: null }),
    );
    const connector = new TrendyolConnector(
      credentials,
      fetcher as typeof fetch,
      async () => undefined,
      3,
      () => Date.now(),
      0,
    );

    await expect(
      connector.readPage({ mode: 'full', cursor: 'page:99' }),
    ).rejects.toThrow('10.000 üzeri katalog için nextPageToken');
  });

  it('retries 429 responses and caps retry-after delays', async () => {
    const sleep = vi.fn(async () => undefined);
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('{}', {
          status: 429,
          headers: { 'retry-after': '999' },
        }),
      )
      .mockResolvedValueOnce(
        new Response('{}', {
          status: 429,
          headers: { 'retry-after': '1' },
        }),
      )
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const connector = new TrendyolConnector(
      credentials,
      fetcher as typeof fetch,
      sleep,
      3,
      () => Date.now(),
      0,
    );

    await connector.validate();

    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenNthCalledWith(1, 30_000);
    expect(sleep).toHaveBeenNthCalledWith(2, 1000);
  });

  it('marks rejected credentials for reauthorization', async () => {
    const fetcher = vi.fn(async () => new Response('{}', { status: 401 }));
    const connector = new TrendyolConnector(
      credentials,
      fetcher as typeof fetch,
      async () => undefined,
      3,
      () => Date.now(),
      0,
    );

    await expect(connector.validate()).rejects.toMatchObject({
      reauthorizationRequired: true,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(connector.validate()).rejects.toBeInstanceOf(
      ConnectorHttpError,
    );
  });

  it('is selected by the provider registry', () => {
    expect(createLiveCatalogConnector('trendyol', credentials).provider).toBe(
      'trendyol',
    );
    expect(() => createLiveCatalogConnector('unknown', {})).toThrow(
      'Desteklenmeyen canlı connector',
    );
  });
});
