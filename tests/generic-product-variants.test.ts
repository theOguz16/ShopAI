import { describe, expect, it } from 'vitest';
import {
  catalogAttributesSchema,
  sourceRowSchema,
} from '../packages/contracts/src/index.js';
import { variantOptionLabel } from '../packages/contracts/src/product-detail.js';
import { genericCatalogRows } from './fixtures/generic-catalog.js';

describe('generic product and variant contracts', () => {
  it('accepts clothing, fishing and sports options without category-specific code', () => {
    const rows = genericCatalogRows.map((row) => sourceRowSchema.parse(row));
    expect(rows[0]?.productAttributes).toEqual([
      { key: 'material', label: 'Malzeme', value: 'cotton' },
    ]);
    expect(rows[0]?.variantOptions?.map((option) => option.value)).toEqual([
      'XL',
      'black',
    ]);
    expect(rows[1]?.variantOptions?.[0]).toMatchObject({
      key: 'length',
      value: '240',
      unit: 'cm',
      rawValue: '240 cm',
    });
    expect(rows[3]?.variantOptions?.[0]).toMatchObject({
      key: 'capacity',
      value: '750',
      unit: 'ml',
    });
    expect(rows[3]?.productAttributes).toBeUndefined();
    expect(
      variantOptionLabel({
        ...rows[3]!,
        size: 'ONE_SIZE',
        color: 'unspecified',
        options: rows[3]?.variantOptions,
      }),
    ).toBe('Capacity: 750 ml');
  });

  it('rejects duplicate option keys and unsupported currencies', () => {
    expect(
      catalogAttributesSchema.safeParse([
        { key: 'Length', value: '240' },
        { key: 'length', value: '270' },
      ]).success,
    ).toBe(false);
    expect(
      sourceRowSchema.safeParse({ ...genericCatalogRows[0], currency: 'EUR' })
        .success,
    ).toBe(false);
  });

  it('labels legacy size/color and preserves raw source strings', () => {
    expect(variantOptionLabel({ size: 'XL', color: 'black' })).toBe(
      'XL · black',
    );
    expect(
      sourceRowSchema.parse(genericCatalogRows[1]).variantOptions?.[0]
        ?.rawValue,
    ).toBe('240 cm');
    expect(
      sourceRowSchema.parse({
        ...genericCatalogRows[0],
        externalId: 'gid://shopify/ProductVariant/123',
        productKey: 'gid://shopify/Product/456',
      }).externalId,
    ).toBe('gid://shopify/ProductVariant/123');
  });
});
