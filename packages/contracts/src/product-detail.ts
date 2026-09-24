import { z } from 'zod';
import {
  catalogItemSchema,
  currencySchema,
  moneySchema,
  stockStatusSchema,
} from './index.js';
import { catalogAttributesSchema } from './catalog-attributes.js';

const publicUrlSchema = z
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

export const productDetailRequestSchema = z
  .object({
    productId: z.string().uuid(),
    searchId: z.string().uuid().optional(),
    discoverySessionId: z.string().uuid().optional(),
  })
  .strict();

export type ProductDetailRequest = z.infer<typeof productDetailRequestSchema>;

export const productDetailImageSchema = z
  .object({
    url: z
      .string()
      .url()
      .refine((value) => new URL(value).protocol === 'https:', 'HTTPS gerekli'),
    alt: z.string().nullable(),
  })
  .strict();

export const productDetailOfferSchema = z
  .object({
    id: z.string().uuid(),
    variantId: z.string().uuid(),
    priceMinor: moneySchema,
    currency: currencySchema,
    available: z.boolean().nullable(),
    availability: stockStatusSchema,
    checkoutAvailable: z.boolean(),
    checkoutUrl: publicUrlSchema.nullable(),
    observedAt: z.string().datetime(),
  })
  .strict();

export const productDetailVariantSchema = z
  .object({
    id: z.string().uuid(),
    size: z.string(),
    color: z.string(),
    options: catalogAttributesSchema.optional(),
    sourceVariantId: z.string().optional(),
    image: productDetailImageSchema.nullable().optional(),
    availability: stockStatusSchema,
    selectable: z.boolean(),
    offerIds: z.array(z.string().uuid()),
  })
  .strict();

export function variantOptionLabel(variant: {
  options?: Array<{
    label?: string;
    key: string;
    value: string;
    unit?: string;
  }>;
  size: string;
  color: string;
}) {
  if (variant.options?.length)
    return variant.options
      .map(
        (option) =>
          `${option.label ?? option.key}: ${option.value}${option.unit ? ` ${option.unit}` : ''}`,
      )
      .join(' · ');
  const legacy = [
    variant.size !== 'ONE_SIZE' ? variant.size : null,
    variant.color !== 'unspecified' ? variant.color : null,
  ].filter(Boolean);
  return legacy.join(' · ') || 'Tek seçenek';
}

export const productDetailResponseSchema = z
  .object({
    searchId: z.string().uuid(),
    discoverySessionId: z.string().uuid().optional(),
    product: z
      .object({
        id: z.string().uuid(),
        title: z.string().min(1),
        category: z.string(),
      })
      .strict(),
    brand: z.string().min(1).nullable(),
    images: z.array(productDetailImageSchema),
    description: z.string(),
    variants: z.array(productDetailVariantSchema),
    offers: z.array(productDetailOfferSchema),
    availability: stockStatusSchema,
    attributes: z.record(z.string(), z.array(z.string())),
    productAttributes: catalogAttributesSchema.optional(),
    merchant: z
      .object({
        id: z.string().uuid(),
        name: z.string().min(1),
        slug: z.string().min(1),
        displayName: z.string().min(1),
        logoUrl: z.string().url().nullable(),
      })
      .strict(),
    checkoutAvailable: z.boolean(),
    similarProducts: z.array(catalogItemSchema),
  })
  .strict();

export type ProductDetailResponse = z.infer<typeof productDetailResponseSchema>;
export type ProductDetailOffer = z.infer<typeof productDetailOfferSchema>;
export type ProductDetailVariant = z.infer<typeof productDetailVariantSchema>;
