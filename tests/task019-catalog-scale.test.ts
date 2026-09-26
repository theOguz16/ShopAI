import type { SourceRow } from '@shopai/contracts';
import { describe, expect, it, vi } from 'vitest';
import {
  createCatalogCounters,
  iterateCatalogPages,
  observePage,
} from '../apps/worker/src/catalog-pages.js';
import {
  chunkCatalogRows,
  CATALOG_IMPORT_BATCH_SIZE,
} from '../apps/worker/src/catalog-sync-engine.js';

const fixtureRow = (index: number): SourceRow => ({
  externalId: String(index),
  productKey: String(index),
  title: `Ürün ${index}`,
  description: 'TASK-019 scale fixture',
  category: 'tshirt',
  imageUrl: null,
  imageAlt: null,
  size: 'M',
  color: 'black',
  priceMinor: 1000 + index,
  currency: 'TRY',
  available: true,
  checkoutUrl: `https://shop.example/products/${index}`,
});

describe('TASK-019 catalog scale guards', () => {
  it('streams 10,100 rows across 101 cursor pages one page at a time', async () => {
    const readPage = vi.fn(async ({ cursor }: { cursor?: string | null }) => {
      const page = cursor ? Number(cursor) : 1;
      const start = (page - 1) * 100 + 1;
      return {
        rows: Array.from({ length: 100 }, (_, offset) =>
          fixtureRow(start + offset),
        ),
        nextCursor: page < 101 ? String(page + 1) : null,
        sourceObservedAt: '2026-09-15T10:00:00.000Z',
        fetchedAt: '2026-09-15T10:01:00.000Z',
        complete: page === 101,
      };
    });
    const counters = createCatalogCounters();
    const pageSizes: number[] = [];

    for await (const page of iterateCatalogPages({
      connector: { readPage },
      mode: 'full',
      modifiedAfter: null,
      onPage: (page) => {
        observePage(counters, page);
        pageSizes.push(page.rows.length);
      },
    })) {
      expect(page.rows.length).toBe(100);
    }

    expect(readPage).toHaveBeenCalledTimes(101);
    expect(pageSizes).toHaveLength(101);
    expect(pageSizes.every((size) => size === 100)).toBe(true);
    expect(counters).toMatchObject({
      pages: 101,
      rowsSeen: 10_100,
      productsSeen: 10_100,
      maxSourceObservedAt: '2026-09-15T10:00:00.000Z',
    });
  });

  it('fails fast on a repeated connector cursor instead of looping forever', async () => {
    const readPage = vi.fn(async () => ({
      rows: [fixtureRow(1)],
      nextCursor: 'same-cursor',
      sourceObservedAt: '2026-09-15T10:00:00.000Z',
      fetchedAt: '2026-09-15T10:01:00.000Z',
      complete: false,
    }));

    await expect(
      (async () => {
        for await (const _page of iterateCatalogPages({
          connector: { readPage },
          mode: 'full',
          modifiedAfter: null,
        })) {
          // consumer releases each page immediately
        }
      })(),
    ).rejects.toThrow('cursor döngüsü');
    expect(readPage).toHaveBeenCalledTimes(2);
  });

  it('fails closed when the source ends without declaring completion', async () => {
    const readPage = vi.fn(async () => ({
      rows: [fixtureRow(1)],
      nextCursor: null,
      sourceObservedAt: '2026-09-15T10:00:00.000Z',
      fetchedAt: '2026-09-15T10:01:00.000Z',
      complete: false,
    }));

    await expect(
      (async () => {
        for await (const _page of iterateCatalogPages({
          connector: { readPage },
          mode: 'full',
          modifiedAfter: null,
        })) {
          // consumer releases each page immediately
        }
      })(),
    ).rejects.toThrow('sayfa sınırında tamamlanamadı');
  });

  it('splits large pages into import batches that respect the 1000-row contract', () => {
    const rows = Array.from({ length: 10_100 }, (_, index) =>
      fixtureRow(index + 1),
    );
    const batches = chunkCatalogRows(rows);

    expect(CATALOG_IMPORT_BATCH_SIZE).toBe(1000);
    expect(batches).toHaveLength(11);
    expect(batches.slice(0, -1).every((batch) => batch.length === 1000)).toBe(
      true,
    );
    expect(batches.at(-1)).toHaveLength(100);
    expect(batches.flat()).toHaveLength(10_100);
    expect(() => chunkCatalogRows(rows, 0)).toThrow();
    expect(() => chunkCatalogRows(rows, 1001)).toThrow();
  });
});
