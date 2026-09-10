import { type SourceRow, sourceRowSchema } from '@shopai/contracts';
import { parse } from 'csv-parse/sync';

export interface CatalogConnector {
  readonly provider: string;
  readonly capabilities: { liveInventory: boolean; incrementalSync: boolean };
  read(): Promise<{
    rows: SourceRow[];
    errors: { line: number; message: string }[];
  }>;
}

export type SyncMode = 'full' | 'incremental';
export type ConnectorPage = {
  rows: SourceRow[];
  nextCursor: string | null;
  sourceObservedAt: string;
  fetchedAt: string;
  complete: boolean;
};
export interface LiveCatalogConnector {
  readonly provider: 'woocommerce';
  readonly capabilities: { liveInventory: true; incrementalSync: true };
  validate(): Promise<void>;
  readPage(input: {
    cursor?: string | null;
    modifiedAfter?: string | null;
    mode: SyncMode;
  }): Promise<ConnectorPage>;
}

export class ConnectorHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly retryAfterMs?: number,
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

export * from './managed-secrets.js';
export * from './providers/woocommerce.js';

export function parseCatalogCsv(content: string) {
  if (Buffer.byteLength(content, 'utf8') > 2 * 1024 * 1024)
    throw new Error('CSV en fazla 2 MB olabilir.');
  const records: Record<string, string>[] = parse(content, {
    columns: true,
    bom: true,
    skip_empty_lines: true,
    trim: true,
    max_record_size: 16000,
  });
  if (records.length > 1000)
    throw new Error('İlk sürüm en fazla 1000 varyant kabul eder.');
  const rows: SourceRow[] = [];
  const errors: { line: number; message: string }[] = [];
  const ids = new Set<string>();
  records.forEach((r, index) => {
    const priceMinor =
      r.price_minor && /^\d+$/u.test(r.price_minor)
        ? Number(r.price_minor)
        : Number.NaN;
    const available =
      r.available === 'true'
        ? true
        : r.available === 'false'
          ? false
          : r.available === ''
            ? null
            : r.available;
    const result = sourceRowSchema.safeParse({
      externalId: r.external_id,
      productKey: r.product_key,
      title: r.title,
      description: r.description ?? '',
      category: r.category,
      imageUrl: r.image_url || null,
      imageAlt: r.image_alt || null,
      size: r.size,
      color: r.color,
      priceMinor,
      currency: r.currency,
      available,
      checkoutUrl: r.checkout_url,
    });
    if (!result.success) {
      errors.push({
        line: index + 2,
        message: result.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; '),
      });
    } else if (ids.has(result.data.externalId)) {
      errors.push({
        line: index + 2,
        message: 'Aynı external_id bir dosyada tekrar edemez.',
      });
    } else {
      ids.add(result.data.externalId);
      rows.push(result.data);
    }
  });
  return { rows, errors };
}
export class CsvConnector implements CatalogConnector {
  readonly provider = 'csv';
  readonly capabilities = { liveInventory: false, incrementalSync: false };
  constructor(private readonly content: string) {}
  async read() {
    return parseCatalogCsv(this.content);
  }
}
