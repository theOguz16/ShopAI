import { z } from 'zod';

// Keys identify source fields. Values and units are kept separately and never
// inferred from an unrelated field.
export const catalogAttributeSchema = z
  .object({
    key: z.string().trim().min(1).max(120),
    label: z.string().trim().min(1).max(160).optional(),
    value: z.string().trim().min(1).max(500),
    unit: z.string().trim().min(1).max(40).optional(),
    sourceKey: z.string().trim().min(1).max(160).optional(),
    rawValue: z.string().max(500).optional(),
    rawValues: z.array(z.string().max(500)).max(100).optional(),
  })
  .strict();

export type CatalogAttribute = z.infer<typeof catalogAttributeSchema>;

export const catalogAttributesSchema = z
  .array(catalogAttributeSchema)
  .max(100)
  .superRefine((attributes, context) => {
    const keys = new Set<string>();
    for (const [index, attribute] of attributes.entries()) {
      const key = attribute.key.toLocaleLowerCase('en-US');
      if (keys.has(key))
        context.addIssue({
          code: 'custom',
          path: [index, 'key'],
          message: 'Duplicate attribute key',
        });
      keys.add(key);
    }
  });

export function canonicalCatalogAttributes(
  attributes: readonly CatalogAttribute[],
) {
  return [...attributes].sort((a, b) => a.key.localeCompare(b.key, 'en-US'));
}
