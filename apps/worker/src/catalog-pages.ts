import {
  type CatalogSyncProgress,
  countCatalogProducts,
} from '@shopai/commerce';
import type { LiveCatalogConnector } from '@shopai/connectors';
import type { SourceRow } from '@shopai/contracts';

/** Hard upper bound on connector pages per sync; memory stays O(maxPages), never O(catalog). */
export const MAX_CATALOG_PAGES = 10_000;

export type CatalogPageCounters = {
  pages: number;
  rowsSeen: number;
  /** Cumulative distinct product keys per fetched page. */
  productsSeen: number;
  maxSourceObservedAt: string | null;
};

export function createCatalogCounters(): CatalogPageCounters {
  return { pages: 0, rowsSeen: 0, productsSeen: 0, maxSourceObservedAt: null };
}

export function progressFromCounters(
  counters: CatalogPageCounters,
  processedProducts: number,
): CatalogSyncProgress {
  return {
    status: 'running',
    foundProducts: counters.productsSeen,
    processedProducts: Math.min(processedProducts, counters.productsSeen),
    failedProducts: Math.max(0, counters.productsSeen - processedProducts),
    variants: counters.rowsSeen,
  };
}

export function observePage(
  counters: CatalogPageCounters,
  page: { rows: SourceRow[]; sourceObservedAt: string },
) {
  counters.pages += 1;
  counters.rowsSeen += page.rows.length;
  counters.productsSeen += countCatalogProducts(page.rows);
  counters.maxSourceObservedAt = latestIsoTimestamp(
    counters.maxSourceObservedAt,
    page.sourceObservedAt,
  );
}

export type IterateCatalogPagesInput = {
  connector: Pick<LiveCatalogConnector, 'readPage'>;
  mode: 'full' | 'incremental';
  modifiedAfter: string | null;
  /** Resume point: the first cursor of a checkpoint-resumed run. */
  startCursor?: string | null;
  maxPages?: number;
  onPage?: (page: {
    rows: SourceRow[];
    nextCursor: string | null;
    sourceObservedAt: string;
    fetchedAt: string;
    complete: boolean;
  }) => Promise<void> | void;
};

/**
 * Streams connector pages one at a time. Each page is yielded and released
 * before the next fetch, so a consumer that does not retain pages never holds
 * more than a single page in memory (natural producer backpressure).
 */
export async function* iterateCatalogPages({
  connector,
  mode,
  modifiedAfter,
  startCursor = null,
  maxPages = MAX_CATALOG_PAGES,
  onPage,
}: IterateCatalogPagesInput): AsyncGenerator<
  {
    rows: SourceRow[];
    nextCursor: string | null;
    sourceObservedAt: string;
    fetchedAt: string;
    complete: boolean;
  },
  void,
  void
> {
  const visitedCursors = new Set<string>();
  let cursor: string | null = startCursor;
  let complete = false;

  for (let pageCount = 0; pageCount < maxPages; pageCount += 1) {
    if (cursor) {
      if (visitedCursors.has(cursor))
        throw new Error('Connector snapshot cursor döngüsü tespit edildi.');
      visitedCursors.add(cursor);
    }

    const page = await connector.readPage({ cursor, modifiedAfter, mode });
    complete = page.complete && !page.nextCursor;
    if (onPage) await onPage(page);
    yield page;
    cursor = page.nextCursor;
    if (!cursor) break;
  }

  if (!complete)
    throw new Error('Connector snapshot sayfa sınırında tamamlanamadı.');
}

function latestIsoTimestamp(left: string | null, right: string) {
  if (!left) return right;
  return left > right ? left : right;
}
