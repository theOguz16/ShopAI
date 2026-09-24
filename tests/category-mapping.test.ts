import { describe, expect, it } from 'vitest';
import { buildCanonicalFacetValues } from '../packages/commerce/src/category-facets.js';

describe('canonical category facets', () => {
  it('uses generic clothing attributes for size, color and material', () => {
    const facets = buildCanonicalFacetValues(
      [
        {
          key: 'size',
          label: 'Beden',
          attributeScope: 'variant',
          attributeKey: 'size',
          unit: null,
        },
        {
          key: 'color',
          label: 'Renk',
          attributeScope: 'variant',
          attributeKey: 'color',
          unit: null,
        },
        {
          key: 'material',
          label: 'Malzeme',
          attributeScope: 'product',
          attributeKey: 'material',
          unit: null,
        },
      ],
      [
        {
          productAttributes: [{ key: 'material', value: 'cotton' }],
          variantOptions: [
            { key: 'size', value: 'M' },
            { key: 'color', value: 'black' },
          ],
        },
        {
          productAttributes: [{ key: 'material', value: 'cotton' }],
          variantOptions: [
            { key: 'size', value: 'L' },
            { key: 'color', value: 'white' },
          ],
        },
      ],
    );

    expect(facets.size?.values).toEqual([
      { value: 'L', count: 1 },
      { value: 'M', count: 1 },
    ]);
    expect(facets.color?.values).toEqual([
      { value: 'black', count: 1 },
      { value: 'white', count: 1 },
    ]);
    expect(facets.material?.values).toEqual([
      { value: 'cotton', count: 2 },
    ]);
  });

  it('does not invent a size facet for fishing and retains length unit metadata', () => {
    const facets = buildCanonicalFacetValues(
      [
        {
          key: 'length',
          label: 'Uzunluk',
          attributeScope: 'variant',
          attributeKey: 'length',
          unit: 'cm',
        },
        {
          key: 'power',
          label: 'Güç',
          attributeScope: 'variant',
          attributeKey: 'power',
          unit: null,
        },
      ],
      [
        {
          variantOptions: [
            {
              key: 'length',
              value: '240',
              unit: 'cm',
              rawValue: '240 cm',
            },
            { key: 'power', value: 'medium' },
          ],
        },
      ],
    );

    expect(facets.size).toBeUndefined();
    expect(facets.length).toEqual({
      label: 'Uzunluk',
      unit: 'cm',
      values: [{ value: '240', count: 1 }],
    });
    expect(facets.power?.values).toEqual([{ value: 'medium', count: 1 }]);
  });

  it('can surface sports capacity and number without category-specific code', () => {
    const facets = buildCanonicalFacetValues(
      [
        {
          key: 'capacity',
          label: 'Kapasite',
          attributeScope: 'variant',
          attributeKey: 'capacity',
          unit: 'ml',
        },
        {
          key: 'number',
          label: 'Numara',
          attributeScope: 'variant',
          attributeKey: 'number',
          unit: null,
        },
      ],
      [
        {
          variantOptions: [
            { key: 'capacity', value: '750', unit: 'ml', rawValue: '750 ml' },
            { key: 'number', value: '5' },
          ],
        },
      ],
    );

    expect(facets.capacity).toEqual({
      label: 'Kapasite',
      unit: 'ml',
      values: [{ value: '750', count: 1 }],
    });
    expect(facets.number?.values).toEqual([{ value: '5', count: 1 }]);
  });
});
