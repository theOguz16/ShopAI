import type { CatalogAttribute } from '@shopai/contracts';
import {
  categoryFacetKeySchema,
  categoryFacetOptionsSchema,
  categoryFacetsResponseSchema,
  type CategoryFacetsResponse,
} from '@shopai/contracts/category-facets';

export type CategoryFacetRow = {
  key: string;
  options: unknown;
};

export type CanonicalFacetDefinitionRow = {
  key: string;
  label: string;
  attributeScope: string;
  attributeKey: string;
  unit: string | null;
  active?: boolean;
};

export type CanonicalFacetRecord = {
  productAttributes?: readonly CatalogAttribute[];
  variantOptions?: readonly CatalogAttribute[];
};

export type CanonicalFacetValues = Record<
  string,
  {
    label: string;
    unit: string | null;
    values: Array<{ value: string; count: number }>;
  }
>;

export function buildCategoryFacetMap(
  rows: readonly CategoryFacetRow[],
): CategoryFacetsResponse {
  const facets: CategoryFacetsResponse = {};
  for (const row of rows) {
    const key = categoryFacetKeySchema.parse(row.key);
    if (key in facets) throw new Error(`Duplicate category facet: ${key}`);
    facets[key] = categoryFacetOptionsSchema.parse(row.options);
  }
  return categoryFacetsResponseSchema.parse(facets);
}

function matchingAttribute(
  attributes: readonly CatalogAttribute[] | undefined,
  key: string,
) {
  const normalizedKey = key.toLocaleLowerCase('en-US');
  return attributes?.find(
    (attribute) => attribute.key.toLocaleLowerCase('en-US') === normalizedKey,
  );
}

export function buildCanonicalFacetValues(
  definitions: readonly CanonicalFacetDefinitionRow[],
  records: readonly CanonicalFacetRecord[],
): CanonicalFacetValues {
  const result: CanonicalFacetValues = {};
  for (const definition of definitions) {
    if (definition.active === false) continue;
    const key = categoryFacetKeySchema.parse(definition.key);
    const counts = new Map<string, number>();
    const observedUnits = new Set<string>();
    for (const record of records) {
      const attributes =
        definition.attributeScope === 'product'
          ? record.productAttributes
          : record.variantOptions;
      const attribute = matchingAttribute(attributes, definition.attributeKey);
      if (!attribute) continue;
      counts.set(attribute.value, (counts.get(attribute.value) ?? 0) + 1);
      if (attribute.unit) observedUnits.add(attribute.unit);
    }
    if (!counts.size) continue;
    const observedUnit =
      observedUnits.size === 1 ? [...observedUnits][0] ?? null : null;
    result[key] = {
      label: definition.label,
      unit: definition.unit ?? observedUnit,
      values: [...counts]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => a.value.localeCompare(b.value, 'tr-TR')),
    };
  }
  return result;
}
