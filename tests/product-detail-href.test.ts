import { describe, expect, it } from 'vitest';
import { buildProductDetailHref } from '../apps/web/lib/product-detail-href.js';

describe('buildProductDetailHref', () => {
  it('preserves searchId from network search to product detail', () => {
    expect(
      buildProductDetailHref({
        productId: 'P1',
        searchId: 'S1',
      }),
    ).toBe('/products/P1?searchId=S1');
  });

  it('preserves searchId and discoverySessionId from branded search to product detail', () => {
    expect(
      buildProductDetailHref({
        productId: 'P1',
        searchId: 'S1',
        discoverySessionId: 'D1',
      }),
    ).toBe('/products/P1?searchId=S1&discoverySessionId=D1');
  });

  it('preserves attribution when moving from product detail to a similar product', () => {
    expect(
      buildProductDetailHref({
        productId: 'P2',
        searchId: 'S1',
        discoverySessionId: 'D1',
      }),
    ).toBe('/products/P2?searchId=S1&discoverySessionId=D1');
  });

  it('keeps direct product detail links clean when there is no attribution context', () => {
    expect(buildProductDetailHref({ productId: 'P1' })).toBe('/products/P1');
  });
});
