import { z } from 'zod';

export const saveProductRequestSchema = z
  .object({
    productId: z.string().uuid(),
    variantId: z.string().uuid().nullable().optional(),
  })
  .strict();

export type SaveProductRequest = z.infer<typeof saveProductRequestSchema>;

export const savedProductSchema = z
  .object({
    id: z.string().uuid(),
    productId: z.string().uuid(),
    variantId: z.string().uuid().nullable(),
    createdAt: z.string().datetime(),
    available: z.boolean(),
    product: z
      .object({
        title: z.string().min(1),
        imageUrl: z.string().url().nullable(),
        imageAlt: z.string().nullable(),
        merchantName: z.string().min(1),
        merchantSlug: z.string().min(1),
      })
      .strict()
      .nullable(),
    variant: z
      .object({
        size: z.string(),
        color: z.string(),
      })
      .strict()
      .nullable(),
  })
  .strict();

export type SavedProduct = z.infer<typeof savedProductSchema>;

export const savedProductResponseSchema = z
  .object({ item: savedProductSchema })
  .strict();

export const savedProductsResponseSchema = z
  .object({ items: z.array(savedProductSchema) })
  .strict();
