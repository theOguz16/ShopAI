import {
  countCatalogProducts,
  type CatalogSyncProgress,
} from '@shopai/commerce';
import type { LiveCatalogConnector } from '@shopai/connectors';
import type { SourceRow } from '@shopai/contracts';

export type CatalogSnapshot = {
  rows: SourceRow[];
  externalIds: Set<string>;
  latestSourceTime: string | null;
  latestFetchedAt: string;
  complete: boolean;
  progress: CatalogSyncProgress;
};

type CatalogReader = Pick<LiveCatalogConnector, 'readPage'>;

type CollectCatalogSnapshotInput = {
  connector: CatalogReader;
  mode: 'full' | 'incremental';
  modifiedAfter: string | null;
  onProgress?: (progress: CatalogSyncProgress) => Promise<void> | void;
};

export async function collectCatalogSnapshot({
  connector,
  mode,
  modifiedAfter,
  onProgress = () => undefined,
}: CollectCatalogSnapshotInput): Promise<CatalogSnapshot> {
  const rows: SourceRow[] = [];
  const externalIds = new Set<string>();
  const productKeys = new Set<string>();
  let cursor: string | null = null;
  let latestSourceTime = modifiedAfter;
  let latestFetchedAt = new Date().toISOString();
  let complete = false;
  let progress: CatalogSyncProgress = {
    status: 'running',
    foundProducts: 0,
    processedProducts: 0,
    failedProducts: 0,
    variants: 0,
  };

  for (let pageCount = 0; pageCount < 100; pageCount += 1) {
    const page = await connector.readPage({
      cursor,
      modifiedAfter,
      mode,
    });
    rows.push(...page.rows);
    for (const row of page.rows) {
      productKeys.add(row.productKey);
      externalIds.add(row.externalId);
    }
    latestSourceTime = [latestSourceTime, page.sourceObservedAt]
      .filter(Boolean)
      .sort()
      .at(-1) as string;
    latestFetchedAt = page.fetchedAt;
    cursor = page.nextCursor;
    complete = page.complete && !cursor;
    progress = {
      status: 'running',
      foundProducts: productKeys.size,
      // readPage has already normalized and schema-validated these products.
      processedProducts: productKeys.size,
      failedProducts: 0,
      variants: rows.length,
    };
    await onProgress(progress);
    if (!cursor) break;
  }

  if (!complete)
    throw new Error('Connector snapshot sayfa sınırında tamamlanamadı.');
  if (progress.foundProducts !== countCatalogProducts(rows))
    throw new Error('Catalog progress ürün sayımı tutarsız.');

  return {
    rows,
    externalIds,
    latestSourceTime,
    latestFetchedAt,
    complete,
    progress,
  };
}
