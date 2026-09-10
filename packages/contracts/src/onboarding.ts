import { z } from 'zod';

const httpsStoreUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .url()
  .refine((value) => new URL(value).protocol === 'https:', 'HTTPS gerekli');

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
        provider: z.literal('woocommerce'),
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
