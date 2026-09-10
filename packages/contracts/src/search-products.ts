import { z } from 'zod';
import { catalogItemSchema, moneySchema, searchFacetsSchema } from './index.js';

const searchAttributeValueSchema = z.union([
  z.string().trim().min(1).max(80),
  z.array(z.string().trim().min(1).max(80)).min(1).max(20),
]);

export const searchProductAttributesSchema = z
  .record(z.string().trim().min(1).max(80), searchAttributeValueSchema)
  .default({});

export type SearchProductAttributes = z.infer<
  typeof searchProductAttributesSchema
>;

export const searchProductsPriceSchema = z
  .object({
    min: moneySchema.optional(),
    max: moneySchema.optional(),
  })
  .strict()
  .refine(
    (price) =>
      price.min === undefined ||
      price.max === undefined ||
      price.min <= price.max,
    { message: 'Alt fiyat üst fiyattan büyük olamaz.' },
  );

export const searchProductsRequestSchema = z
  .object({
    discoverySessionId: z.string().uuid().optional(),
    merchantIds: z.array(z.string().uuid()).max(20).optional(),
    query: z.string().trim().max(500).optional(),
    category: z.string().trim().min(1).max(80).optional(),
    price: searchProductsPriceSchema.optional(),
    attributes: searchProductAttributesSchema.optional(),
    inStockOnly: z.boolean().optional(),
    cursor: z.string().trim().min(1).max(500).optional(),
    limit: z.number().int().min(1).max(50).optional(),
  })
  .strict();

export type SearchProductsRequest = z.infer<typeof searchProductsRequestSchema>;

export const searchProductsResponseSchema = z
  .object({
    products: z.array(catalogItemSchema),
    facets: searchFacetsSchema,
    nextCursor: z.string().optional(),
    searchId: z.string().uuid(),
  })
  .strict();

export type SearchProductsResponse = z.infer<
  typeof searchProductsResponseSchema
>;
