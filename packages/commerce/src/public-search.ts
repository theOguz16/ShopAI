import type {
  SearchFilters,
  SearchRequest,
  SearchResponse,
} from '@shopai/contracts';
import {
  type SearchProductsRequest,
  type SearchProductsResponse,
  searchProductsRequestSchema,
  searchProductsResponseSchema,
} from '@shopai/contracts/search-products';

export type InternalSearchInput = Omit<Partial<SearchRequest>, 'filters'> & {
  filters?: Partial<SearchFilters>;
};

const supportedAttributeKeys = new Set(['size', 'sizes', 'color', 'colors']);

function valuesFor(
  attributes: SearchProductsRequest['attributes'],
  keys: readonly string[],
) {
  const values = keys.flatMap((key) => {
    const value = attributes?.[key];
    if (value === undefined) return [];
    return Array.isArray(value) ? value : [value];
  });
  return [...new Set(values)];
}

export function parseSearchProductsRequest(
  input: unknown,
): SearchProductsRequest {
  return searchProductsRequestSchema.parse(input);
}

export function toInternalSearchInput(
  request: SearchProductsRequest,
): InternalSearchInput {
  const attributes = request.attributes ?? {};
  const unsupported = Object.keys(attributes).filter(
    (key) => !supportedAttributeKeys.has(key),
  );
  if (unsupported.length)
    throw Object.assign(
      new Error(`Desteklenmeyen ürün niteliği: ${unsupported.join(', ')}`),
      { statusCode: 400, code: 'UNSUPPORTED_SEARCH_ATTRIBUTE' },
    );

  const filters: Partial<SearchFilters> = {};
  if (request.category !== undefined) filters.category = request.category;
  if (request.price?.min !== undefined)
    filters.minPriceMinor = request.price.min;
  if (request.price?.max !== undefined)
    filters.maxPriceMinor = request.price.max;
  if (request.inStockOnly !== undefined)
    filters.inStockOnly = request.inStockOnly;

  const sizes = valuesFor(attributes, ['size', 'sizes']);
  const colors = valuesFor(attributes, ['color', 'colors']);
  if (sizes.length) filters.sizes = sizes;
  if (colors.length) filters.colors = colors;

  return {
    ...(request.discoverySessionId
      ? { discoverySessionId: request.discoverySessionId }
      : {}),
    ...(request.merchantIds ? { merchantIds: request.merchantIds } : {}),
    ...(request.query !== undefined ? { query: request.query } : {}),
    ...(Object.keys(filters).length ? { filters } : {}),
    ...(request.cursor !== undefined ? { cursor: request.cursor } : {}),
    ...(request.limit !== undefined ? { limit: request.limit } : {}),
  };
}

export function toSearchProductsResponse(
  result: SearchResponse,
): SearchProductsResponse {
  return searchProductsResponseSchema.parse({
    products: result.items,
    facets: result.facets,
    ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
    searchId: result.searchId,
  });
}
