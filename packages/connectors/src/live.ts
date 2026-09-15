import type { SourceRow } from '@shopai/contracts';

export type SyncMode = 'full' | 'incremental';
export const LIVE_CATALOG_PROVIDERS = ['woocommerce', 'trendyol'] as const;
export type LiveCatalogProvider = (typeof LIVE_CATALOG_PROVIDERS)[number];

export type ConnectorPage = {
  rows: SourceRow[];
  nextCursor: string | null;
  sourceObservedAt: string;
  fetchedAt: string;
  complete: boolean;
};

export interface LiveCatalogConnector {
  readonly provider: LiveCatalogProvider;
  readonly capabilities: { liveInventory: true; incrementalSync: true };
  validate(): Promise<void>;
  readPage(input: {
    cursor?: string | null;
    modifiedAfter?: string | null;
    mode: SyncMode;
  }): Promise<ConnectorPage>;
}

export type ConnectorHttpDiagnostics = {
  contentType?: string;
  upstreamServer?: string;
  retryAfter?: string;
  cfRay?: string;
  requestId?: string;
  responseBodySnippet?: string;
};

export class ConnectorHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly retryAfterMs?: number,
    readonly diagnostics?: ConnectorHttpDiagnostics,
  ) {
    super(message);
  }

  get retryable() {
    return this.status === 429 || this.status >= 500;
  }

  get reauthorizationRequired() {
    return this.status === 401 || this.status === 403;
  }
}
