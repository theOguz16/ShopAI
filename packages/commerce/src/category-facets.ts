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
