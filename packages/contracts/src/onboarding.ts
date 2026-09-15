import { z } from 'zod';

const httpsStoreUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .url()
  .refine((value) => new URL(value).protocol === 'https:', 'HTTPS gerekli')
  .refine((value) => {
    const url = new URL(value);
    return !url.username && !url.password && !url.hash;
  }, 'Store URL kullanıcı bilgisi veya fragment içeremez');

export const connectorOnboardingProviderSchema = z.enum([
  'woocommerce',
  'trendyol',
]);
export type ConnectorOnboardingProvider = z.infer<
  typeof connectorOnboardingProviderSchema
>;

export const woocommerceOnboardingCredentialsSchema = z
  .object({
    storeUrl: httpsStoreUrlSchema,
    consumerKey: z.string().trim().min(3).max(256),
    consumerSecret: z.string().trim().min(3).max(256),
  })
  .strict();
export type WooCommerceOnboardingCredentials = z.infer<
  typeof woocommerceOnboardingCredentialsSchema
>;

export const trendyolOnboardingCredentialsSchema = z
  .object({
    sellerId: z.string().trim().regex(/^\d+$/u).max(32),
    apiKey: z.string().trim().min(3).max(256),
    apiSecret: z.string().trim().min(3).max(256),
    environment: z.enum(['production', 'stage']).default('production'),
  })
  .strict();
export type TrendyolOnboardingCredentials = z.infer<
  typeof trendyolOnboardingCredentialsSchema
>;

export const connectorTestResponseSchema = z
  .object({
    status: z.enum(['success', 'failed']),
    code: z.enum(['CONNECTION_OK', 'CONNECTION_FAILED']),
  })
  .strict();
export type ConnectorTestResponse = z.infer<typeof connectorTestResponseSchema>;

export const connectorOnboardingResponseSchema = z
  .object({
    connection: z
      .object({
        id: z.string().uuid(),
        provider: connectorOnboardingProviderSchema,
        authorizationStatus: z.literal('pending'),
        syncMode: z.enum(['full', 'incremental']),
      })
      .strict(),
    sync: z
      .object({
        status: z.enum(['queued', 'pending_retry']),
      })
      .strict(),
  })
  .strict();
export type ConnectorOnboardingResponse = z.infer<
  typeof connectorOnboardingResponseSchema
>;
