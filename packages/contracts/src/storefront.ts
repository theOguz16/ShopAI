import { z } from 'zod';

export const storefrontSlugSchema = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);

const optionalHttpsUrlSchema = z
  .string()
  .url()
  .refine((value) => new URL(value).protocol === 'https:', 'HTTPS gerekli')
  .nullable();

export const publicStorefrontSchema = z
  .object({
    id: z.string().uuid(),
    slug: storefrontSlugSchema,
    displayName: z.string().trim().min(1).max(160),
    logoUrl: optionalHttpsUrlSchema,
    coverImageUrl: optionalHttpsUrlSchema,
    primaryColor: z.string().regex(/^#[0-9a-f]{6}$/iu),
    isPublic: z.literal(true),
  })
  .strict();

export type PublicStorefront = z.infer<typeof publicStorefrontSchema>;
