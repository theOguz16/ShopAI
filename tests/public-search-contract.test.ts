import { describe, expect, it } from 'vitest';
import {
  parseSearchProductsRequest,
  toInternalSearchInput,
  toSearchProductsResponse,
} from '../packages/commerce/src/public-search.js';
import type { SearchResponse } from '../packages/contracts/src/index.js';
import { searchProductsResponseSchema } from '../packages/contracts/src/search-products.js';

const searchId = '10000000-0000-4000-8000-000000000099';

describe('public product discovery contract', () => {
  it('maps canonical price and attributes into the internal search model', () => {
    const request = parseSearchProductsRequest({
      merchantIds: ['10000000-0000-4000-8000-000000000001'],
      query: 'siyah tişört',
      category: 'tshirt',
      price: { min: 50_000, max: 150_000 },
      attributes: { size: ['M', 'L'], color: 'black' },
      inStockOnly: false,
      limit: 20,
    });

    expect(toInternalSearchInput(request)).toEqual({
      merchantIds: ['10000000-0000-4000-8000-000000000001'],
      query: 'siyah tişört',
      filters: {
        category: 'tshirt',
        minPriceMinor: 50_000,
        maxPriceMinor: 150_000,
        inStockOnly: false,
        sizes: ['M', 'L'],
        colors: ['black'],
      },
      limit: 20,
    });
  });

  it('fails closed for attributes the current commerce engine cannot apply', () => {
    expect(() =>
      toInternalSearchInput(
        parseSearchProductsRequest({ attributes: { material: 'cotton' } }),
      ),
    ).toThrow('Desteklenmeyen ürün niteliği: material');
  });

  it('returns only the stabilized public response fields', () => {
    const internal = {
      schemaVersion: 1,
      searchId,
      items: [],
      nextCursor: null,
      facets: { categories: [], sizes: [], colors: [] },
      appliedFilters: {
        sizes: [],
        colors: [],
        excludedSizes: [],
        excludedColors: [],
        excludedCategories: [],
        currency: 'TRY',
        inStockOnly: true,
      },
      warnings: [],
      telemetry: {
        provider: 'rules',
        model: 'deterministic-v1',
        promptVersion: 'search-intent-v1',
        latencyMs: 0,
        estimatedCostUsd: 0,
        inputTokens: 0,
        outputTokens: 0,
        fallback: false,
      },
      mode: 'demo',
    } satisfies SearchResponse;

    const response = toSearchProductsResponse(internal);
    expect(response).toEqual({
      products: [],
      facets: { categories: [], sizes: [], colors: [] },
      searchId,
    });
    expect(searchProductsResponseSchema.parse(response)).toEqual(response);
    expect(() =>
      searchProductsResponseSchema.parse({ ...response, mode: 'demo' }),
    ).toThrow();
  });
});
