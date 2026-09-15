import type { SourceRow } from '@shopai/contracts';
import { describe, expect, it, vi } from 'vitest';
import { collectCatalogSnapshot } from '../apps/worker/src/catalog-sync-progress.js';
import { chunkCatalogRows } from '../apps/worker/src/sync.js';

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
  it('collects 10,100 rows across 101 cursor pages', async () => {
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

    const snapshot = await collectCatalogSnapshot({
      connector: { readPage },
      mode: 'full',
      modifiedAfter: null,
    });

    expect(readPage).toHaveBeenCalledTimes(101);
    expect(snapshot.rows).toHaveLength(10_100);
    expect(snapshot.externalIds.size).toBe(10_100);
    expect(snapshot.complete).toBe(true);
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
      collectCatalogSnapshot({
        connector: { readPage },
        mode: 'full',
        modifiedAfter: null,
      }),
    ).rejects.toThrow('cursor döngüsü');
    expect(readPage).toHaveBeenCalledTimes(2);
  });

  it('splits large snapshots into import jobs that respect the 1000-row contract', () => {
    const rows = Array.from({ length: 10_100 }, (_, index) =>
      fixtureRow(index + 1),
    );
    const batches = chunkCatalogRows(rows);

    expect(batches).toHaveLength(11);
    expect(batches.slice(0, -1).every((batch) => batch.length === 1000)).toBe(
      true,
    );
    expect(batches.at(-1)).toHaveLength(100);
    expect(batches.flat()).toHaveLength(10_100);
  });
});
