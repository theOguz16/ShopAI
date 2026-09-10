import type { SourceRow } from '@shopai/contracts';

export const CATALOG_SYNC_STATUSES = [
  'queued',
  'running',
  'completed',
  'partial',
  'failed',
] as const;

export type CatalogSyncStatus = (typeof CATALOG_SYNC_STATUSES)[number];

export type CatalogSyncProgress = {
  status: CatalogSyncStatus;
  foundProducts: number;
  processedProducts: number;
  failedProducts: number;
  variants: number;
};

export const EMPTY_CATALOG_SYNC_PROGRESS: CatalogSyncProgress = {
  status: 'queued',
  foundProducts: 0,
  processedProducts: 0,
  failedProducts: 0,
  variants: 0,
};

export function countCatalogProducts(
  rows: readonly Pick<SourceRow, 'productKey'>[],
) {
  return new Set(rows.map((row) => row.productKey)).size;
}

export function catalogSyncFailureStatus(
  progress: Pick<CatalogSyncProgress, 'processedProducts'>,
): Extract<CatalogSyncStatus, 'partial' | 'failed'> {
  return progress.processedProducts > 0 ? 'partial' : 'failed';
}

export function isCatalogSyncStatus(value: string): value is CatalogSyncStatus {
  return CATALOG_SYNC_STATUSES.some((status) => status === value);
}
