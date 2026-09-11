import { describe, expect, it } from 'vitest';
import { buildCategoryFacetMap } from '../packages/commerce/src/category-facets.js';

describe('category facets', () => {
  it('builds a stable facet response from persisted rows', () => {
    expect(
      buildCategoryFacetMap([
        { key: 'size', options: ['S', 'M', 'L'] },
        { key: 'fit', options: ['regular', 'oversized'] },
      ]),
    ).toEqual({
      size: ['S', 'M', 'L'],
      fit: ['regular', 'oversized'],
    });
  });

  it('fails closed on duplicate facet keys', () => {
    expect(() =>
      buildCategoryFacetMap([
        { key: 'size', options: ['S'] },
        { key: 'size', options: ['M'] },
      ]),
    ).toThrow('Duplicate category facet: size');
  });
});
