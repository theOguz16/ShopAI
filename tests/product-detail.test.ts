import { describe, expect, it } from 'vitest';
import {
  MemoryCatalogRepository,
  SearchProducts,
  demoRecords,
} from '../packages/commerce/src/index.js';
import {
  MemoryProductDetailRepository,
  ProductDetails,
} from '../packages/commerce/src/product-detail.js';

const parser = {
  async parse() {
    return {
      filters: {},
      warnings: [],
      telemetry: {
        provider: 'rules',
        model: 'test',
        promptVersion: 'test',
        latencyMs: 0,
        estimatedCostUsd: 0,
        inputTokens: 0,
        outputTokens: 0,
        fallback: false,
      },
    };
  },
};

describe('product detail', () => {
  it('makes only fresh in-stock variants selectable', async () => {
    const search = new SearchProducts(
      new MemoryCatalogRepository(demoRecords),
      parser,
      'demo',
    );
    const service = new ProductDetails(
      new MemoryProductDetailRepository(demoRecords),
      search,
    );

    const result = await service.execute({
      productId: '20000000-0000-4000-8000-000000000001',
    });

    const medium = result.variants.find((variant) => variant.size === 'M');
    const large = result.variants.find((variant) => variant.size === 'L');
    expect(medium).toMatchObject({
      availability: 'in_stock',
      selectable: true,
    });
    expect(large).toMatchObject({
      availability: 'out_of_stock',
      selectable: false,
    });

    const mediumOffer = result.offers.find(
      (offer) => offer.variantId === medium?.id,
    );
    const largeOffer = result.offers.find(
      (offer) => offer.variantId === large?.id,
    );
    expect(mediumOffer?.checkoutAvailable).toBe(true);
    expect(mediumOffer?.checkoutUrl).toMatch(/^https:/u);
    expect(largeOffer).toMatchObject({
      checkoutAvailable: false,
      checkoutUrl: null,
    });
    expect(result.checkoutAvailable).toBe(true);
    expect(result.brand).toBeNull();
  });
});
