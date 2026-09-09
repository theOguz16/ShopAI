import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DemoQueryParser } from '../../packages/ai/src/index.js';
import {
  DEMO_MERCHANT_ID,
  demoRecords,
  MemoryCatalogRepository,
  SearchProducts,
} from '../../packages/commerce/src/index.js';
import { parseCatalogCsv } from '../../packages/connectors/src/index.js';

const create = (records = demoRecords) =>
  new SearchProducts(
    new MemoryCatalogRepository(records),
    new DemoQueryParser(),
    'demo',
  );
describe('search invariants', () => {
  it('matches price, size and availability on the same offer', async () => {
    const result = await create().execute({
      query: 'Siyah M beden tişört 1500 TL altında',
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.size).toBe('M');
    expect(
      (await create().execute({ filters: { sizes: ['L'], inStockOnly: true } }))
        .items,
    ).toHaveLength(0);
  });
  it('uses remaining free text against title and description', async () => {
    const named = await create().execute({ query: 'Günlük tişört' });
    expect(named.items.map((item) => item.title)).toEqual([
      'Günlük Beyaz Tişört',
    ]);
    expect(
      (await create().execute({ query: 'bulunmayanürünadı' })).items,
    ).toEqual([]);
  });
  it('never relaxes explicit filters or merchant scope', async () => {
    expect(
      (await create().execute({ query: 'M beden', filters: { sizes: ['XL'] } }))
        .items,
    ).toHaveLength(0);
    expect(
      (
        await create().execute({
          merchantIds: ['90000000-0000-4000-8000-000000000001'],
        })
      ).items,
    ).toHaveLength(0);
  });
  it('hides draft records and inactive merchants/offers', async () => {
    const service = new SearchProducts(
      new MemoryCatalogRepository(
        demoRecords.map((r) => ({ ...r, published: false })),
      ),
      new DemoQueryParser(),
      'demo',
    );
    expect((await service.execute({})).items).toHaveLength(0);
  });
  it('does not turn negative preferences into positive filters', async () => {
    const result = await create().execute({ query: 'siyah olmayan tişört' });
    expect(result.appliedFilters.colors).toEqual([]);
    expect(result.appliedFilters.excludedColors).toEqual(['black']);
    expect(result.items.every((item) => item.color !== 'black')).toBe(true);
  });
  it('rejects unsafe price and excessive limits', async () => {
    await expect(
      create().execute({ filters: { maxPriceMinor: -1 } }),
    ).rejects.toThrow();
    await expect(create().execute({ limit: 1000 })).rejects.toThrow();
  });
  it('paginates deterministically and returns facets plus a search id', async () => {
    const first = await create().execute({
      filters: { inStockOnly: false },
      limit: 2,
    });
    expect(first.searchId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(first.nextCursor).toBeTruthy();
    expect(first.facets.categories).toEqual([{ value: 'tshirt', count: 4 }]);
    const second = await create().execute({
      filters: { inStockOnly: false },
      limit: 2,
      cursor: first.nextCursor ?? undefined,
    });
    const ids = [...first.items, ...second.items].map((item) => item.offerId);
    expect(new Set(ids).size).toBe(4);
    expect(ids).toHaveLength(4);
    expect(second.nextCursor).toBeNull();
  });
  it('does not present stale stock as current inventory', async () => {
    const staleRecords = demoRecords.map((record, index) =>
      index === 0
        ? {
            ...record,
            stockObservedAt: '2020-01-01T00:00:00.000Z',
          }
        : record,
    );
    const all = await create(staleRecords).execute({
      query: 'Minimal',
      filters: { inStockOnly: false },
    });
    expect(all.items.find((item) => item.size === 'M')?.stockStatus).toBe(
      'stale',
    );
    const inStock = await create(staleRecords).execute({ query: 'Minimal' });
    expect(inStock.items).toEqual([]);
  });
  it('intersects a requested merchant with the server view scope', async () => {
    const result = await create().execute(
      { merchantIds: [DEMO_MERCHANT_ID] },
      { merchantIds: ['90000000-0000-4000-8000-000000000001'] },
    );
    expect(result.items).toEqual([]);
  });
});
describe('CSV boundary', () => {
  const fixture = readFileSync(
    new URL('../fixtures/catalog.csv', import.meta.url),
    'utf8',
  );
  it('validates the catalog and preserves stock false', () => {
    const result = parseCatalogCsv(fixture);
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(3);
    expect(result.rows[1]?.available).toBe(false);
  });
  it('rejects duplicate ids, invalid prices and unsafe URLs', () => {
    expect(
      parseCatalogCsv(`${fixture}${fixture.split('\n')[1]}\n`).errors,
    ).toHaveLength(1);
    expect(parseCatalogCsv(fixture.replace('89900', '-1')).errors).toHaveLength(
      1,
    );
    expect(
      parseCatalogCsv(
        fixture.replace(
          'https://example.com/products/black',
          'javascript:alert(1)',
        ),
      ).errors,
    ).toHaveLength(1);
  });
});
