import type { SourceRow } from '../../packages/contracts/src/index.js';

const checkoutUrl = 'https://merchant.example/products/item';

export const genericCatalogRows: SourceRow[] = [
  {
    externalId: 'apparel-XL-black',
    productKey: 'apparel-1',
    title: 'Pamuk tişört',
    description: 'Kaynak açıklaması',
    category: 'Tişört',
    productAttributes: [{ key: 'material', label: 'Malzeme', value: 'cotton' }],
    variantOptions: [
      { key: 'size', label: 'Beden', value: 'XL' },
      { key: 'color', label: 'Renk', value: 'black' },
    ],
    size: 'XL',
    color: 'black',
    priceMinor: 12000,
    currency: 'TRY',
    available: true,
    checkoutUrl,
  },
  {
    externalId: 'rod-240',
    productKey: 'rod-1',
    title: 'Karbon olta',
    description: 'Kaynak açıklaması',
    category: 'Olta',
    sourceCategoryId: 'fishing-rods',
    sourceCategoryPath: ['Balıkçılık', 'Oltalar'],
    imageUrl: 'https://merchant.example/rod.jpg',
    productAttributes: [
      { key: 'rod_material', label: 'Olta malzemesi', value: 'carbon' },
    ],
    variantOptions: [
      {
        key: 'length',
        label: 'Uzunluk',
        value: '240',
        unit: 'cm',
        rawValue: '240 cm',
      },
      { key: 'power', label: 'Güç', value: 'medium' },
    ],
    variantImageUrl: 'https://merchant.example/rod-240.jpg',
    priceMinor: 32000,
    currency: 'TRY',
    available: true,
    checkoutUrl: 'https://merchant.example/products/rod?variant=240',
  },
  {
    externalId: 'rod-270',
    productKey: 'rod-1',
    title: 'Karbon olta',
    description: 'Kaynak açıklaması',
    category: 'Olta',
    sourceCategoryId: 'fishing-rods',
    sourceCategoryPath: ['Balıkçılık', 'Oltalar'],
    imageUrl: 'https://merchant.example/rod.jpg',
    productAttributes: [
      { key: 'rod_material', label: 'Olta malzemesi', value: 'carbon' },
    ],
    variantOptions: [
      { key: 'power', label: 'Güç', value: 'medium' },
      {
        key: 'length',
        label: 'Uzunluk',
        value: '270',
        unit: 'cm',
        rawValue: '270 cm',
      },
    ],
    priceMinor: 35000,
    currency: 'TRY',
    available: false,
    checkoutUrl: 'https://merchant.example/products/rod?variant=270',
  },
  {
    externalId: 'bottle-750',
    productKey: 'bottle-1',
    title: 'Spor şişesi',
    description: 'Kaynak açıklaması',
    category: 'Spor',
    variantOptions: [
      {
        key: 'capacity',
        label: 'Capacity',
        value: '750',
        unit: 'ml',
        rawValue: '750 ml',
      },
    ],
    priceMinor: 8900,
    currency: 'TRY',
    available: null,
    checkoutUrl: 'https://merchant.example/products/bottle?capacity=750',
  },
];
