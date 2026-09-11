export * from './attribution.js';
export * from './discovery.js';
export * from './onboarding.js';
export * from './storefront.js';
export * from './anonymous-shopping-profile.js';
export * from './saved-products.js';

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
    discoverySessionId: z.string().uuid().optional(),
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
  size: z.string(),
  color: z.string(),
  imageUrl: httpsUrlSchema.nullable().optional(),
  imageAlt: z.string().nullable().optional(),
  priceMinor: moneySchema,
  currency: currencySchema,
  stockStatus: stockStatusSchema,
  checkoutUrl: publicLinkSchema,
});
export type CatalogItem = z.infer<typeof catalogItemSchema>;
export const searchResponseSchema = z.object({
  items: z.array(catalogItemSchema),
  searchId: z.string().uuid(),
  nextCursor: z.string().nullable().optional(),
});
export type SearchResponse = z.infer<typeof searchResponseSchema>;
export const searchEventRequestSchema = z.object({
  searchId: z.string().uuid(),
  event: z.enum(['view', 'click', 'conversion']),
});
export const conversionRequestSchema = z.object({
  eventId: z.string().uuid(),
  searchId: z.string().uuid(),
  offerId: z.string().uuid(),
  kind: z.enum(['purchase', 'refund', 'cancel']),
  externalOrderId: z.string().min(1).max(255),
  amountMinor: moneySchema,
  currency: currencySchema,
  occurredAt: z.string().datetime(),
});
export type ConversionRequest = z.infer<typeof conversionRequestSchema>;
export const importRowSchema = z.object({
  externalId: z.string().min(1),
  productKey: z.string().min(1),
  title: z.string().min(1),
  description: z.string().default(''),
  category: z.string().min(1),
  size: z.string().min(1),
  color: z.string().min(1),
  imageUrl: httpsUrlSchema.optional(),
  imageAlt: z.string().optional(),
  priceMinor: moneySchema,
  currency: currencySchema,
  available: z.boolean().nullable(),
  checkoutUrl: httpsUrlSchema,
});
export type ImportRow = z.infer<typeof importRowSchema>;
export const importEventSchema = z.object({
  schemaVersion: z.literal(1),
  runId: z.string().uuid(),
  merchantId: z.string().uuid(),
  connectionId: z.string().uuid(),
  observedAt: z.string().datetime(),
  rows: z.array(importRowSchema).min(1),
});
export type ImportEvent = z.infer<typeof importEventSchema>;
export const importRunStatusSchema = z.enum([
  'accepted',
  'processing',
  'completed',
  'completed_with_errors',
  'failed',
]);
export type ImportRunStatus = z.infer<typeof importRunStatusSchema>;
export const importRunReportSchema = z.object({
  runId: z.string().uuid(),
  merchantId: z.string().uuid(),
  status: importRunStatusSchema,
  rowCount: z.number().int().nonnegative(),
  errorCount: z.number().int().nonnegative(),
  errors: z.array(
    z.object({
      line: z.number().int().positive(),
      code: z.string(),
      message: z.string(),
    }),
  ),
});
export type ImportRunReport = z.infer<typeof importRunReportSchema>;
export const connectorProviderSchema = z.enum(['woocommerce', 'shopify', 'csv']);
export type ConnectorProvider = z.infer<typeof connectorProviderSchema>;
export const connectionAuthorizationStatusSchema = z.enum([
  'pending',
  'active',
  'reauthorization_required',
  'revoked',
]);
export type ConnectionAuthorizationStatus = z.infer<
  typeof connectionAuthorizationStatusSchema
>;
export const merchantProfileSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  slug: z.string().min(1),
  active: z.boolean(),
});
export type MerchantProfile = z.infer<typeof merchantProfileSchema>;
export const connectionSummarySchema = z.object({
  id: z.string().uuid(),
  merchantId: z.string().uuid(),
  provider: connectorProviderSchema,
  active: z.boolean(),
  authorizationStatus: connectionAuthorizationStatusSchema,
  syncMode: z.enum(['full', 'incremental']),
  lastSyncStartedAt: z.string().datetime().nullable(),
  lastSuccessfulSyncAt: z.string().datetime().nullable(),
  lastFetchedAt: z.string().datetime().nullable(),
  lastSyncError: z.string().nullable(),
  revokedAt: z.string().datetime().nullable(),
  conversionTrackingEnabled: z.boolean(),
});
export type ConnectionSummary = z.infer<typeof connectionSummarySchema>;
