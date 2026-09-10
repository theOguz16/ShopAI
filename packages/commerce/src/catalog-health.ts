export const CATALOG_CONNECTION_STALE_AFTER_MS = 30 * 60 * 1000;

export type CatalogConnectionHealth =
  | 'healthy'
  | 'stale'
  | 'pending'
  | 'attention';

export type CatalogConnectionHealthInput = {
  active: boolean;
  authorizationStatus: string;
  lastSuccessfulSyncAt: string | Date | null;
  lastSyncError: string | null;
};

export function catalogConnectionHealth(
  input: CatalogConnectionHealthInput,
  now = Date.now(),
): CatalogConnectionHealth {
  if (
    !input.active ||
    input.authorizationStatus === 'revoked' ||
    input.authorizationStatus === 'reauthorization_required' ||
    input.lastSyncError
  )
    return 'attention';

  if (!input.lastSuccessfulSyncAt) return 'pending';

  const lastSuccessfulSyncAt = new Date(input.lastSuccessfulSyncAt).getTime();
  if (
    !Number.isFinite(lastSuccessfulSyncAt) ||
    now - lastSuccessfulSyncAt > CATALOG_CONNECTION_STALE_AFTER_MS
  )
    return 'stale';

  return 'healthy';
}
