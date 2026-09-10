import type { SourceRow } from '@shopai/contracts';
import { describe, expect, it, vi } from 'vitest';
import { collectCatalogSnapshot } from '../apps/worker/src/catalog-sync-progress.js';

const fixtureRow = (index: number): SourceRow => ({
  externalId: String(index),
  productKey: String(index),
  title: `Ürün ${index}`,
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

describe('catalog sync worker progress', () => {
  it('collects a 10k-product fixture in 100 worker pages with persistent progress callbacks', async () => {
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
    const updates: Array<{
      foundProducts: number;
      processedProducts: number;
      failedProducts: number;
      variants: number;
    }> = [];

    const snapshot = await collectCatalogSnapshot({
      connector: { readPage },
      mode: 'full',
      modifiedAfter: null,
      onProgress: (progress) => {
        updates.push(progress);
      },
    });

    expect(readPage).toHaveBeenCalledTimes(100);
    expect(updates).toHaveLength(100);
    expect(updates[0]).toMatchObject({
      foundProducts: 100,
      processedProducts: 100,
      failedProducts: 0,
      variants: 100,
    });
    expect(updates.at(-1)).toMatchObject({
      foundProducts: 10_000,
      processedProducts: 10_000,
      failedProducts: 0,
      variants: 10_000,
    });
    expect(snapshot.rows).toHaveLength(10_000);
    expect(snapshot.externalIds.size).toBe(10_000);
    expect(snapshot.complete).toBe(true);
    expect(snapshot.progress.status).toBe('running');
  });
});
