import type { SourceRow } from '@shopai/contracts';
import { describe, expect, it, vi } from 'vitest';
import {
  createCatalogCounters,
  iterateCatalogPages,
  observePage,
  progressFromCounters,
} from '../apps/worker/src/catalog-pages.js';

const fixtureRow = (index: number): SourceRow => ({
  externalId: String(index),
  productKey: String(Math.floor((index - 1) / 2) + 1),
  title: `Ürün ${Math.floor((index - 1) / 2) + 1}`,
  description: '10k sync fixture',
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

describe('catalog sync worker progress counters', () => {
  it('tracks 10k variant rows / 5k products across 100 worker pages without HTTP request work', async () => {
    const readPage = vi.fn(async ({ cursor }: { cursor?: string | null }) => {
      const page = cursor ? Number(cursor) : 1;
      const start = (page - 1) * 100 + 1;
      return {
        rows: Array.from({ length: 100 }, (_, offset) =>
          fixtureRow(start + offset),
        ),
        nextCursor: page < 100 ? String(page + 1) : null,
        sourceObservedAt: '2026-09-10T10:00:00.000Z',
        fetchedAt: `2026-09-10T10:${String(Math.min(page, 59)).padStart(2, '0')}:00.000Z`,
        complete: page === 100,
      };
    });
    const counters = createCatalogCounters();
    const progressSnapshots: Array<ReturnType<typeof progressFromCounters>> =
      [];

    for await (const page of iterateCatalogPages({
      connector: { readPage },
      mode: 'full',
      modifiedAfter: null,
      onPage: (page) => {
        observePage(counters, page);
        progressSnapshots.push(progressFromCounters(counters, 0));
      },
    })) {
      void page;
    }

    expect(readPage).toHaveBeenCalledTimes(100);
    expect(progressSnapshots).toHaveLength(100);
    expect(progressSnapshots[0]).toMatchObject({
      status: 'running',
      foundProducts: 50,
      processedProducts: 0,
      failedProducts: 50,
      variants: 100,
    });
    expect(progressSnapshots.at(-1)).toMatchObject({
      status: 'running',
      foundProducts: 5_000,
      processedProducts: 0,
      failedProducts: 5_000,
      variants: 10_000,
    });

    // Every committed product moves from failed to processed without ever
    // breaking the connection_sync_progress check constraint.
    const committed = progressFromCounters(counters, 5_000);
    expect(committed).toMatchObject({
      foundProducts: 5_000,
      processedProducts: 5_000,
      failedProducts: 0,
      variants: 10_000,
    });
    expect(
      committed.processedProducts +
        committed.failedProducts -
        committed.foundProducts,
    ).toBe(0);
  });

  it('keeps per-page distinct product counting monotonic across pages', () => {
    const counters = createCatalogCounters();
    observePage(counters, {
      rows: [fixtureRow(1), fixtureRow(2)],
      sourceObservedAt: '2026-09-10T10:00:00.000Z',
    });
    observePage(counters, {
      rows: [fixtureRow(3), fixtureRow(4)],
      sourceObservedAt: '2026-09-10T10:01:00.000Z',
    });
    expect(counters.pages).toBe(2);
    expect(counters.rowsSeen).toBe(4);
    expect(counters.productsSeen).toBe(2);
    expect(counters.maxSourceObservedAt).toBe('2026-09-10T10:01:00.000Z');
  });
});
