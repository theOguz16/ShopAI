import { z } from 'zod';

const preferenceKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/u);

const preferenceValueSchema = z.string().trim().min(1).max(80);
const preferenceValuesSchema = z.array(preferenceValueSchema).max(20);

export const preferredSizesSchema = z
  .record(preferenceKeySchema, preferenceValuesSchema)
  .default({});
export const preferredColorsSchema = z
  .record(preferenceKeySchema, preferenceValuesSchema)
  .default({});
export const preferredStylesSchema = z
  .record(preferenceKeySchema, preferenceValuesSchema)
  .default({});

export const preferredPriceRangeSchema = z
  .object({
    minPriceMinor: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER)
      .optional(),
    maxPriceMinor: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER)
      .optional(),
    currency: z.literal('TRY').default('TRY'),
  })
  .strict()
  .refine(
    (range) =>
      range.minPriceMinor === undefined ||
      range.maxPriceMinor === undefined ||
      range.minPriceMinor <= range.maxPriceMinor,
    { message: 'Alt fiyat üst fiyattan büyük olamaz.' },
  );

export const preferredPriceRangesSchema = z
  .record(preferenceKeySchema, preferredPriceRangeSchema)
  .default({});

export const anonymousShoppingProfileSchema = z
  .object({
    anonymousUserId: z.string().uuid(),
    preferredSizes: preferredSizesSchema,
    preferredColors: preferredColorsSchema,
    preferredStyles: preferredStylesSchema,
    preferredPriceRanges: preferredPriceRangesSchema,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export type AnonymousShoppingProfile = z.infer<
  typeof anonymousShoppingProfileSchema
>;

export const anonymousShoppingProfileUpdateSchema = z
  .object({
    category: preferenceKeySchema,
    preferredSizes: preferenceValuesSchema.optional(),
    preferredColors: preferenceValuesSchema.optional(),
    preferredStyles: preferenceValuesSchema.optional(),
    preferredPriceRange: preferredPriceRangeSchema.nullable().optional(),
  })
  .strict()
  .refine(
    (input) =>
      input.preferredSizes !== undefined ||
      input.preferredColors !== undefined ||
      input.preferredStyles !== undefined ||
      input.preferredPriceRange !== undefined,
    { message: 'En az bir explicit tercih gönderilmeli.' },
  );

export type AnonymousShoppingProfileUpdate = z.infer<
  typeof anonymousShoppingProfileUpdateSchema
>;
