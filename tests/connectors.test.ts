import { describe, expect, it, vi } from 'vitest';
import {
  ConnectorHttpError,
  WooCommerceConnector,
} from '../packages/connectors/src/index.js';

const credentials = {
  storeUrl: 'https://pilot.example',
  consumerKey: 'ck_test',
  consumerSecret: 'cs_test',
};

function product(id: number, price = '1499.90') {
  return {
    id,
    name: 'Pilot Tişört',
    description: '<p>Pamuklu ürün</p>',
    permalink: `https://pilot.example/product/${id}`,
    price,
    status: 'publish',
    stock_status: 'instock',
    date_modified_gmt: '2026-09-07T12:00:00',
    categories: [{ slug: 'tisort' }],
    images: [{ src: 'https://pilot.example/image.jpg', alt: 'Tişört' }],
    attributes: [
      { name: 'Beden', options: ['M'] },
      { name: 'Renk', options: ['Siyah'] },
    ],
  };
}

describe('WooCommerce pilot connector', () => {
  it('validates, paginates and sends an incremental watermark', async () => {
    const calls: URL[] = [];
    const fetcher = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      calls.push(url);
      return new Response(
        JSON.stringify([product(Number(url.searchParams.get('page') ?? 1))]),
        {
          status: 200,
          headers: { 'x-wp-totalpages': '2' },
        },
      );
    });
    const connector = new WooCommerceConnector(
      credentials,
      fetcher as typeof fetch,
      undefined,
      3,
      async () => 'TRY',
    );
    await connector.validate();
    const first = await connector.readPage({
      mode: 'incremental',
      modifiedAfter: '2026-09-01T00:00:00.000Z',
    });
    const second = await connector.readPage({
      mode: 'incremental',
      modifiedAfter: '2026-09-01T00:00:00.000Z',
      cursor: first.nextCursor,
    });
    expect(first.nextCursor).toBe('2');
    expect(second.complete).toBe(true);
    expect(first.rows[0]).toMatchObject({
      externalId: '1',
      priceMinor: 149990,
      available: true,
      size: 'M',
      color: 'Siyah',
    });
    expect(
      calls
        .find((url) => url.searchParams.has('modified_after'))
        ?.searchParams.get('modified_after'),
    ).toBe('2026-09-01T00:00:00.000Z');
  });

  it('completes an empty incremental result with zero total pages', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify([]), {
          status: 200,
          headers: {
            'x-wp-total': '0',
            'x-wp-totalpages': '0',
          },
        }),
    );
    const connector = new WooCommerceConnector(
      credentials,
      fetcher as typeof fetch,
      undefined,
      3,
      async () => 'TRY',
    );

    const page = await connector.readPage({
      mode: 'incremental',
      modifiedAfter: '2026-09-07T12:00:00.000Z',
    });

    expect(page).toMatchObject({
      rows: [],
      nextCursor: null,
      sourceObservedAt: '2026-09-07T12:00:00.000Z',
      complete: true,
    });
  });

  it('completes a normal single-page response', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify([product(1)]), {
          status: 200,
          headers: { 'x-wp-totalpages': '1' },
        }),
    );
    const connector = new WooCommerceConnector(
      credentials,
      fetcher as typeof fetch,
      undefined,
      3,
      async () => 'TRY',
    );

    const page = await connector.readPage({ mode: 'full' });

    expect(page.rows).toHaveLength(1);
    expect(page.nextCursor).toBeNull();
    expect(page.complete).toBe(true);
  });

  it.each([
    ['text', 'not-a-number', []],
    ['negative', '-1', []],
    ['fractional', '1.5', []],
    ['zero with a non-empty page', '0', [product(1)]],
  ])(
    'rejects malformed product pagination: %s',
    async (_case, totalPages, body) => {
      const fetcher = vi.fn(
        async () =>
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'x-wp-totalpages': totalPages },
          }),
      );
      const connector = new WooCommerceConnector(
        credentials,
        fetcher as typeof fetch,
        undefined,
        3,
        async () => 'TRY',
      );

      await expect(connector.readPage({ mode: 'incremental' })).rejects.toThrow(
        'WooCommerce geçersiz sayfalama bilgisi döndürdü.',
      );
    },
  );

  it('bounds 429 retries and honors a capped retry-after', async () => {
    const sleep = vi.fn(async () => undefined);
    const fetcher = vi.fn(
      async () =>
        new Response('{}', { status: 429, headers: { 'retry-after': '999' } }),
    );
    const connector = new WooCommerceConnector(
      credentials,
      fetcher as typeof fetch,
      sleep,
      3,
      async () => 'TRY',
    );
    await expect(connector.validate()).rejects.toBeInstanceOf(
      ConnectorHttpError,
    );
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(30_000);
  });

  it('reads every WooCommerce variation instead of collapsing options', async () => {
    const variable = {
      ...product(10, ''),
      type: 'variable',
      attributes: [
        { name: 'Beden', options: ['S', 'M', 'L'] },
        { name: 'Renk', options: ['Siyah'] },
      ],
    };
    const fetcher = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      const body = url.pathname.endsWith('/variations')
        ? ['S', 'M', 'L'].map((size, index) => ({
            id: 101 + index,
            price: '1499.90',
            stock_status: index === 2 ? 'outofstock' : 'instock',
            date_modified_gmt: '2020-01-01T00:00:00',
            attributes: [{ name: 'Beden', option: size }],
          }))
        : [variable];
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'x-wp-totalpages': '1' },
      });
    });
    const connector = new WooCommerceConnector(
      credentials,
      fetcher as typeof fetch,
      undefined,
      3,
      async () => 'TRY',
    );

    const page = await connector.readPage({ mode: 'full' });

    expect(page.rows).toHaveLength(3);
    expect(page.rows.map((row) => row.size)).toEqual(['S', 'M', 'L']);
    expect(page.rows.map((row) => row.externalId)).toEqual([
      '101',
      '102',
      '103',
    ]);
    expect(page.rows[2]?.available).toBe(false);
    expect(new Date(page.fetchedAt).getTime()).toBeGreaterThan(
      new Date(page.sourceObservedAt).getTime(),
    );
  });

  it('preserves non-apparel options, units, source images and variant stock', async () => {
    const variable = {
      ...product(40, ''),
      type: 'variable',
      name: 'Karbon olta',
      categories: [{ slug: 'fishing-rods' }],
      attributes: [
        { name: 'Rod material', options: ['carbon'], variation: false },
        { name: 'Length', options: ['240 cm', '270 cm'], variation: true },
      ],
    };
    const fetcher = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      const body = url.pathname.endsWith('/variations')
        ? [
            {
              id: 401,
              price: '320.00',
              stock_status: 'instock',
              date_modified_gmt: '2026-09-07T12:00:00',
              attributes: [{ name: 'Length', option: '240 cm' }],
              image: { src: 'https://pilot.example/rod-240.jpg' },
            },
            {
              id: 402,
              price: '350.00',
              stock_status: 'outofstock',
              date_modified_gmt: '2026-09-07T12:00:00',
              attributes: [{ name: 'Length', option: '270 cm' }],
            },
          ]
        : [variable];
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'x-wp-totalpages': '1' },
      });
    });
    const connector = new WooCommerceConnector(
      credentials,
      fetcher as typeof fetch,
      undefined,
      3,
      async () => 'TRY',
    );
    const page = await connector.readPage({ mode: 'full' });
    expect(page.rows[0]).toMatchObject({
      productKey: '40',
      externalId: '401',
      priceMinor: 32000,
      available: true,
      productAttributes: [
        { key: 'rod_material', value: 'carbon', rawValues: ['carbon'] },
      ],
      variantOptions: [
        { key: 'length', value: '240', unit: 'cm', rawValue: '240 cm' },
      ],
      imageUrl: 'https://pilot.example/image.jpg',
      variantImageUrl: 'https://pilot.example/rod-240.jpg',
    });
    expect(page.rows[1]).toMatchObject({
      externalId: '402',
      priceMinor: 35000,
      available: false,
      variantImageUrl: null,
    });
    expect(page.rows[0]?.productAttributes).not.toEqual(
      page.rows[0]?.variantOptions,
    );
  });

  it('rejects an unsupported WooCommerce currency before importing prices', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify([product(1)]), {
          status: 200,
          headers: { 'x-wp-totalpages': '1' },
        }),
    );
    const connector = new WooCommerceConnector(
      credentials,
      fetcher as typeof fetch,
      undefined,
      3,
      async () => 'EUR',
    );
    await expect(connector.readPage({ mode: 'full' })).rejects.toThrow(
      'para birimi desteklenmiyor',
    );
  });

  it.each([
    ['missing', undefined],
    ['invalid', 'not-a-number'],
  ])(
    'does not complete a full snapshot when variation pagination is %s',
    async (_case, variationPages) => {
      const variable = { ...product(20, ''), type: 'variable' };
      const fetcher = vi.fn(async (input: URL | RequestInfo) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith('/variations'))
          return new Response(
            JSON.stringify([
              {
                id: 201,
                price: '1499.90',
                stock_status: 'instock',
                date_modified_gmt: '2026-09-07T12:00:00',
                attributes: [{ name: 'Beden', option: 'M' }],
              },
            ]),
            {
              status: 200,
              headers: variationPages
                ? { 'x-wp-totalpages': variationPages }
                : undefined,
            },
          );
        return new Response(JSON.stringify([variable]), {
          status: 200,
          headers: { 'x-wp-totalpages': '1' },
        });
      });
      const connector = new WooCommerceConnector(
        credentials,
        fetcher as typeof fetch,
        undefined,
        3,
        async () => 'TRY',
      );

      const page = await connector.readPage({ mode: 'full' });

      expect(page.complete).toBe(false);
      expect(page.nextCursor).toBeNull();
      expect(page.rows.map((row) => row.externalId)).toEqual(['201']);
    },
  );

  it('fetches every declared variation page before completing a snapshot', async () => {
    const variable = { ...product(30, ''), type: 'variable' };
    const variationCalls: number[] = [];
    const fetcher = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/variations')) {
        const page = Number(url.searchParams.get('page'));
        variationCalls.push(page);
        return new Response(
          JSON.stringify([
            {
              id: 300 + page,
              price: '1499.90',
              stock_status: 'instock',
              date_modified_gmt: '2026-09-07T12:00:00',
              attributes: [{ name: 'Beden', option: page === 1 ? 'S' : 'M' }],
            },
          ]),
          { status: 200, headers: { 'x-wp-totalpages': '2' } },
        );
      }
      return new Response(JSON.stringify([variable]), {
        status: 200,
        headers: { 'x-wp-totalpages': '1' },
      });
    });
    const connector = new WooCommerceConnector(
      credentials,
      fetcher as typeof fetch,
      undefined,
      3,
      async () => 'TRY',
    );

    const page = await connector.readPage({ mode: 'full' });

    expect(variationCalls).toEqual([1, 2]);
    expect(page.complete).toBe(true);
    expect(page.rows.map((row) => row.externalId)).toEqual(['301', '302']);
  });

  it('marks revoked credentials for reauthorization without retrying', async () => {
    const fetcher = vi.fn(async () => new Response('{}', { status: 401 }));
    const connector = new WooCommerceConnector(
      credentials,
      fetcher as typeof fetch,
      undefined,
      3,
      async () => 'TRY',
    );
    await expect(connector.validate()).rejects.toMatchObject({
      reauthorizationRequired: true,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
