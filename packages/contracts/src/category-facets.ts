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
  .min(1)
  .max(100);

export const categoryFacetsResponseSchema = z.record(
  categoryFacetKeySchema,
  categoryFacetOptionsSchema,
);

export type CategoryFacetsResponse = z.infer<
  typeof categoryFacetsResponseSchema
>;
