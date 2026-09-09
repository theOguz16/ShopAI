import { z } from 'zod';

export const moneySchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
export const currencySchema = z.enum(['TRY']);
const httpsUrlSchema = z
  .string()
  .url()
  .refine((v) => new URL(v).protocol === 'https:', 'HTTPS gerekli');
const publicLinkSchema = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === 'https:' ||
      (url.protocol === 'http:' &&
        ['127.0.0.1', 'localhost'].includes(url.hostname))
    );
  }, 'HTTPS veya yerel geliştirme adresi gerekli');
export const searchFiltersSchema = z
  .object({
    category: z.string().trim().min(1).max(80).optional(),
    sizes: z.array(z.string().min(1).max(20)).max(20).default([]),
    colors: z.array(z.string().min(1).max(40)).max(20).default([]),
    excludedSizes: z.array(z.string().min(1).max(20)).max(20).default([]),
    excludedColors: z.array(z.string().min(1).max(40)).max(20).default([]),
    excludedCategories: z.array(z.string().min(1).max(80)).max(20).default([]),
    minPriceMinor: moneySchema.optional(),
    maxPriceMinor: moneySchema.optional(),
    currency: currencySchema.default('TRY'),
    inStockOnly: z.boolean().default(true),
  })
  .strict();
export const searchRequestSchema = z
  .object({
    query: z.string().trim().max(500).default(''),
    filters: searchFiltersSchema.default({}),
    merchantIds: z.array(z.string().uuid()).max(20).default([]),
    limit: z.number().int().min(1).max(50).default(12),
    cursor: z.string().trim().min(1).max(500).optional().nullable(),
  })
  .strict();
export type SearchRequest = z.infer<typeof searchRequestSchema>;
export type SearchFilters = z.infer<typeof searchFiltersSchema>;
export const stockStatusSchema = z.enum([
  'in_stock',
  'out_of_stock',
  'unknown',
  'stale',
]);
export type StockStatus = z.infer<typeof stockStatusSchema>;
export const STOCK_STATUS_LABELS: Readonly<Record<StockStatus, string>> = {
  in_stock: 'Stokta',
  out_of_stock: 'Stok yok',
  unknown: 'Stok bilgisi bilinmiyor',
  stale: 'Stok bilgisi eski; güncel durum bilinmiyor',
};
export function stockStatusLabel(status: StockStatus) {
  return STOCK_STATUS_LABELS[status];
}
export const catalogItemSchema = z.object({
  productId: z.string().uuid(),
  variantId: z.string().uuid(),
  offerId: z.string().uuid(),
  merchantId: z.string().uuid(),
  merchantName: z.string().min(1),
  title: z.string().min(1),
  description: z.string(),
  category: z.string(),
  imageUrl: z
    .string()
    .url()
    .refine((v) => new URL(v).protocol === 'https:', 'HTTPS gerekli')
    .nullable()
    .default(null),
  imageAlt: z.string().nullable().default(null),
  size: z.string(),
  color: z.string(),
  priceMinor: moneySchema,
  currency: currencySchema,
  available: z.boolean().nullable(),
  stockStatus: stockStatusSchema,
  priceSource: z.string().min(1).default('catalog-import'),
  stockSource: z.string().min(1).default('catalog-import'),
  priceObservedAt: z.string().datetime().nullable().default(null),
  stockObservedAt: z.string().datetime().nullable().default(null),
  observedAt: z.string().datetime(),
  checkoutUrl: publicLinkSchema,
});
export type CatalogItem = z.infer<typeof catalogItemSchema>;
export const facetValueSchema = z.object({
  value: z.string().min(1),
  count: z.number().int().nonnegative(),
});
export const searchFacetsSchema = z.object({
  categories: z.array(facetValueSchema),
  sizes: z.array(facetValueSchema),
  colors: z.array(facetValueSchema),
});
export type SearchFacets = z.infer<typeof searchFacetsSchema>;
export const parserTelemetrySchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  promptVersion: z.string().min(1),
  latencyMs: z.number().nonnegative(),
  estimatedCostUsd: z.number().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  fallback: z.boolean(),
  fallbackReason: z.string().optional(),
});
export type ParserTelemetry = z.infer<typeof parserTelemetrySchema>;
export const modelSearchIntentSchema = z
  .object({
    category: z.string().min(1).max(80).nullable(),
    colors: z.array(z.string().min(1).max(40)).max(20),
    excludedColors: z.array(z.string().min(1).max(40)).max(20),
    sizes: z.array(z.string().min(1).max(20)).max(20),
    excludedSizes: z.array(z.string().min(1).max(20)).max(20),
    excludedCategories: z.array(z.string().min(1).max(80)).max(20),
    minPriceMinor: moneySchema.nullable(),
    maxPriceMinor: moneySchema.nullable(),
    inStockOnly: z.boolean().nullable(),
    ambiguous: z.boolean(),
    unsupported: z.array(z.string().min(1).max(160)).max(10),
  })
  .strict()
  .refine(
    (intent) =>
      intent.minPriceMinor === null ||
      intent.maxPriceMinor === null ||
      intent.minPriceMinor <= intent.maxPriceMinor,
    { message: 'Alt fiyat üst fiyattan büyük olamaz.' },
  );
export type ModelSearchIntent = z.infer<typeof modelSearchIntentSchema>;
export const searchResponseSchema = z.object({
  schemaVersion: z.literal(1),
  searchId: z.string().uuid(),
  items: z.array(catalogItemSchema),
  nextCursor: z.string().nullable(),
  facets: searchFacetsSchema,
  appliedFilters: searchFiltersSchema,
  warnings: z.array(z.string()),
  telemetry: parserTelemetrySchema,
  mode: z.enum(['demo', 'postgres']),
});
export type SearchResponse = z.infer<typeof searchResponseSchema>;
export const storeSlugSchema = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
export const publicStoreSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(160),
    slug: storeSlugSchema,
  })
  .strict();
export type PublicStore = z.infer<typeof publicStoreSchema>;
export const sourceRowSchema = z.object({
  externalId: z.string().trim().min(1).max(160),
  productKey: z.string().trim().min(1).max(160),
  title: z.string().trim().min(1).max(240),
  description: z.string().max(5000).default(''),
  category: z.string().trim().min(1).max(80),
  imageUrl: z
    .string()
    .url()
    .refine((v) => new URL(v).protocol === 'https:', 'HTTPS gerekli')
    .optional()
    .nullable(),
  imageAlt: z.string().trim().max(240).optional().nullable(),
  size: z.string().trim().min(1).max(20),
  color: z.string().trim().min(1).max(40),
  priceMinor: moneySchema,
  currency: currencySchema,
  available: z.boolean().nullable(),
  checkoutUrl: httpsUrlSchema,
});
export type SourceRow = z.infer<typeof sourceRowSchema>;
export const importJobSchema = z
  .object({
    schemaVersion: z.literal(1),
    runId: z.string().uuid(),
    observedAt: z.string().datetime(),
    merchantId: z.string().uuid(),
    connectionId: z.string().uuid(),
    rows: z.array(sourceRowSchema).min(1).max(1000),
  })
  .strict();
export type ImportJob = z.infer<typeof importJobSchema>;
export const publicationChangeSchema = z
  .object({ published: z.boolean() })
  .strict();
export type PublicationChange = z.infer<typeof publicationChangeSchema>;
export const bulkPublicationChangeSchema = z
  .object({
    productIds: z.array(z.string().uuid()).min(1).max(100),
    published: z.boolean(),
  })
  .strict();
export type BulkPublicationChange = z.infer<typeof bulkPublicationChangeSchema>;
export const IMPORT_QUEUE = 'catalog-import';
export const SYNC_QUEUE = 'catalog-sync';
export const syncJobSchema = z
  .object({
    merchantId: z.string().uuid(),
    connectionId: z.string().uuid(),
  })
  .strict();
export type SyncJob = z.infer<typeof syncJobSchema>;
