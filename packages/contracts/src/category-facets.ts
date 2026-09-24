import { z } from 'zod';

export const categorySlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);

export const categoryFacetKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9_]+$/u);

export const categoryFacetOptionsSchema = z
  .array(z.string().trim().min(1).max(120))
  .max(100);

export const canonicalCategorySchema = z
  .object({
    key: categorySlugSchema,
    label: z.string().trim().min(1).max(160),
    parentKey: categorySlugSchema.nullable(),
    active: z.boolean(),
  })
  .strict();

export const categoryFacetDefinitionSchema = z
  .object({
    key: categoryFacetKeySchema,
    label: z.string().trim().min(1).max(160),
    attributeScope: z.enum(['product', 'variant']),
    attributeKey: categoryFacetKeySchema,
    unit: z.string().trim().min(1).max(40).nullable(),
    position: z.number().int(),
  })
  .strict();

export type CanonicalCategory = z.infer<typeof canonicalCategorySchema>;
export type CategoryFacetDefinition = z.infer<
  typeof categoryFacetDefinitionSchema
>;

export const categoryFacetsResponseSchema = z.record(
  categoryFacetKeySchema,
  categoryFacetOptionsSchema,
);

export type CategoryFacetsResponse = z.infer<
  typeof categoryFacetsResponseSchema
>;
