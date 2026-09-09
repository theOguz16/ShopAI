import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WooCommerceConnector } from '../packages/connectors/src/index.js';

const enabled = process.env.SHOPAI_WOO_REHEARSAL === '1';
const storeUrl = process.env.WOO_STORE_URL ?? 'https://localhost:18443';
const readCredentials = {
  storeUrl,
  consumerKey: process.env.WOO_READ_KEY ?? '',
  consumerSecret: process.env.WOO_READ_SECRET ?? '',
};
const writerAuthorization = `Basic ${Buffer.from(
  `${process.env.WOO_WRITE_KEY ?? ''}:${process.env.WOO_WRITE_SECRET ?? ''}`,
).toString('base64')}`;

type WooEntity = { id: number; name?: string };

async function woo(path: string, init: RequestInit = {}) {
  const response = await fetch(`${storeUrl}/wp-json/wc/v3/${path}`, {
    ...init,
    headers: {
      authorization: writerAuthorization,
      'content-type': 'application/json',
      ...init.headers,
    },
  });
  if (!response.ok)
    throw new Error(`WooCommerce ${response.status}: ${await response.text()}`);
  return (await response.json()) as WooEntity | WooEntity[];
}

async function readSnapshot(
  connector = new WooCommerceConnector(readCredentials),
) {
  const rows = [];
  let cursor: string | null = null;
  let complete = false;
  do {
    const page = await connector.readPage({ mode: 'full', cursor });
    rows.push(...page.rows);
    cursor = page.nextCursor;
    complete = page.complete && !cursor;
  } while (cursor);
  return { rows, complete };
}

describe.skipIf(!enabled)('real WooCommerce rehearsal', () => {
  let simpleId = 0;
  let variableId = 0;
  let smallVariationId = 0;
  let mediumVariationId = 0;

  beforeAll(async () => {
    const existing = (await woo('products?per_page=100')) as WooEntity[];
    for (const product of existing.filter((item) =>
      item.name?.startsWith('[ShopAI Rehearsal]'),
    ))
      await woo(`products/${product.id}?force=true`, { method: 'DELETE' });

    const simple = (await woo('products', {
      method: 'POST',
      body: JSON.stringify({
        name: '[ShopAI Rehearsal] Basic Tee',
        type: 'simple',
        status: 'publish',
        regular_price: '499.90',
        manage_stock: true,
        stock_quantity: 4,
        attributes: [
          { name: 'Beden', visible: true, options: ['M'] },
          { name: 'Renk', visible: true, options: ['Siyah'] },
        ],
      }),
    })) as WooEntity;
    simpleId = simple.id;

    const variable = (await woo('products', {
      method: 'POST',
      body: JSON.stringify({
        name: '[ShopAI Rehearsal] Variable Shirt',
        type: 'variable',
        status: 'publish',
        attributes: [
          {
            name: 'Beden',
            visible: true,
            variation: true,
            options: ['S', 'M', 'L'],
          },
          {
            name: 'Renk',
            visible: true,
            variation: true,
            options: ['Lacivert'],
          },
        ],
      }),
    })) as WooEntity;
    variableId = variable.id;
    const small = (await woo(`products/${variableId}/variations`, {
      method: 'POST',
      body: JSON.stringify({
        regular_price: '699.90',
        manage_stock: true,
        stock_quantity: 3,
        attributes: [
          { name: 'Beden', option: 'S' },
          { name: 'Renk', option: 'Lacivert' },
        ],
      }),
    })) as WooEntity;
    smallVariationId = small.id;
    const medium = (await woo(`products/${variableId}/variations`, {
      method: 'POST',
      body: JSON.stringify({
        regular_price: '749.90',
        manage_stock: true,
        stock_quantity: 2,
        attributes: [
          { name: 'Beden', option: 'M' },
          { name: 'Renk', option: 'Lacivert' },
        ],
      }),
    })) as WooEntity;
    mediumVariationId = medium.id;
  }, 120_000);

  afterAll(async () => {
    for (const id of [simpleId, variableId].filter(Boolean))
      await woo(`products/${id}?force=true`, { method: 'DELETE' });
  });

  it('reconciles IDs, attributes, prices and stock through lifecycle changes', async () => {
    const connector = new WooCommerceConnector(readCredentials);
    await connector.validate();
    const initial = await readSnapshot(connector);
    expect(initial.complete).toBe(true);
    expect(initial.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          externalId: String(simpleId),
          size: 'M',
          color: 'Siyah',
          priceMinor: 49990,
          available: true,
        }),
        expect.objectContaining({
          externalId: String(smallVariationId),
          productKey: String(variableId),
          size: 'S',
          color: 'Lacivert',
          priceMinor: 69990,
          available: true,
        }),
        expect.objectContaining({
          externalId: String(mediumVariationId),
          productKey: String(variableId),
          size: 'M',
          color: 'Lacivert',
          priceMinor: 74990,
          available: true,
        }),
      ]),
    );

    await woo(`products/${simpleId}`, {
      method: 'PUT',
      body: JSON.stringify({ regular_price: '549.90', stock_quantity: 0 }),
    });
    await woo(`products/${variableId}/variations/${mediumVariationId}`, {
      method: 'PUT',
      body: JSON.stringify({
        regular_price: '799.90',
        attributes: [
          { name: 'Beden', option: 'L' },
          { name: 'Renk', option: 'Lacivert' },
        ],
      }),
    });
    const changed = await readSnapshot(connector);
    expect(changed.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          externalId: String(simpleId),
          priceMinor: 54990,
          available: false,
        }),
        expect.objectContaining({
          externalId: String(mediumVariationId),
          size: 'L',
          priceMinor: 79990,
        }),
      ]),
    );

    const removedSimpleId = simpleId;
    await woo(`products/${removedSimpleId}?force=true`, { method: 'DELETE' });
    simpleId = 0;
    const removed = await readSnapshot(connector);
    expect(
      removed.rows.some((row) => row.externalId === String(removedSimpleId)),
    ).toBe(false);
  }, 120_000);

  it('rejects revoked credentials and recovers with the valid read key', async () => {
    const revoked = new WooCommerceConnector({
      ...readCredentials,
      consumerSecret: 'cs_revoked_rehearsal_key',
    });
    await expect(revoked.validate()).rejects.toMatchObject({
      reauthorizationRequired: true,
    });
    await expect(
      new WooCommerceConnector(readCredentials).validate(),
    ).resolves.toBeUndefined();
  });

  it('marks a real response incomplete when a proxy drops pagination proof', async () => {
    const stripPaginationHeader: typeof fetch = async (input, init) => {
      const response = await fetch(input, init);
      const headers = new Headers(response.headers);
      headers.delete('x-wp-totalpages');
      return new Response(await response.arrayBuffer(), {
        status: response.status,
        headers,
      });
    };
    const page = await new WooCommerceConnector(
      readCredentials,
      stripPaginationHeader,
    ).readPage({ mode: 'full' });
    expect(page.rows.length).toBeGreaterThan(0);
    expect(page.complete).toBe(false);
  });
});
