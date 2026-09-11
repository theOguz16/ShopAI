import { z } from 'zod';

const MAX_ORDER_VALUE_TRY = Number.MAX_SAFE_INTEGER / 100;

export const merchantConversionRequestSchema = z
  .object({
    clickId: z.string().uuid(),
    orderId: z.string().trim().min(1).max(200),
    orderValue: z
      .number()
      .finite()
      .nonnegative()
      .max(MAX_ORDER_VALUE_TRY)
      .refine(
        (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-7,
        'orderValue en fazla iki ondalık basamak içerebilir.',
      ),
    currency: z.literal('TRY'),
  })
  .strict();

export type MerchantConversionRequest = z.infer<
  typeof merchantConversionRequestSchema
>;

export const merchantConversionResponseSchema = z
  .object({
    accepted: z.literal(true),
    conversionId: z.string().uuid(),
    duplicate: z.boolean(),
    clickId: z.string().uuid(),
    searchId: z.string().uuid(),
    discoverySessionId: z.string().uuid().nullable(),
    surface: z.enum(['web', 'chatgpt', 'gemini', 'brand_widget']),
  })
  .strict();

export type MerchantConversionResponse = z.infer<
  typeof merchantConversionResponseSchema
>;

export const MERCHANT_CONVERSION_HEADERS = {
  merchantId: 'x-shopai-merchant-id',
  timestamp: 'x-shopai-timestamp',
  signature: 'x-shopai-signature',
} as const;
