import { describe, expect, it } from 'vitest';
import {
  clearPriceFilter,
  QUERY_CONTEXT_PRESENTATION,
  queryContextChips,
  removeQueryContext,
  resolveWidgetView,
  selectCategory,
  toggleAttributeFilter,
  WIDGET_VIEWS,
} from '../apps/chatgpt-widget/src/shopping-state.js';

describe('ChatGPT visual shopping state', () => {
  it('moves broad results through category select, grid, and detail states', () => {
    const result = {
      products: [],
      facets: {
        categories: [
          { value: 'tshirt', count: 2 },
          { value: 'fishing-rod', count: 1 },
        ],
        sizes: [],
        colors: [],
      },
      searchId: '11111111-1111-4111-8111-111111111111',
    };

    expect(resolveWidgetView({ request: {}, result, hasDetail: false })).toBe(
      WIDGET_VIEWS.CATEGORY_SELECT,
    );
    expect(
      resolveWidgetView({
        request: { category: 'tshirt' },
        result,
        hasDetail: false,
      }),
    ).toBe(WIDGET_VIEWS.PRODUCT_GRID);
    expect(
      resolveWidgetView({
        request: { category: 'tshirt' },
        result,
        hasDetail: true,
      }),
    ).toBe(WIDGET_VIEWS.PRODUCT_DETAIL);
  });

  it('builds fresh canonical searches when quick facets change', () => {
    const input = {
      query: 'oversize tişört',
      category: 'tshirt',
      attributes: { color: ['black'] },
      price: { min: 50_000, max: 150_000 },
      cursor: 'next-page',
    };

    expect(toggleAttributeFilter(input, 'size', 'M')).toEqual({
      query: 'oversize tişört',
      category: 'tshirt',
      attributes: { color: ['black'], size: ['M'] },
      price: { min: 50_000, max: 150_000 },
    });
    expect(toggleAttributeFilter(input, 'color', 'black')).toEqual({
      query: 'oversize tişört',
      category: 'tshirt',
      attributes: {},
      price: { min: 50_000, max: 150_000 },
    });
    expect(selectCategory(input, 'fishing-rod')).toEqual({
      query: 'oversize tişört',
      category: 'fishing-rod',
      attributes: { color: ['black'] },
      price: { min: 50_000, max: 150_000 },
    });
    expect(clearPriceFilter(input)).toEqual({
      query: 'oversize tişört',
      category: 'tshirt',
      attributes: { color: ['black'] },
    });
  });

  it('keeps unsupported fit intent as query context instead of a hard filter', () => {
    const input = {
      query: 'Siyah oversized tişört göster',
      category: 'tshirt',
      attributes: { color: ['black'] },
    };

    expect(queryContextChips(input.query)).toEqual([
      { id: 'fit:oversized', label: 'Oversize' },
    ]);
    expect(QUERY_CONTEXT_PRESENTATION).toEqual({
      groupLabel: 'Arama bağlamı',
      chipClassName: 'facet-chip facet-chip-context',
      tooltip: 'Arama metninde korunuyor; kesin filtre değildir.',
    });
    expect(QUERY_CONTEXT_PRESENTATION.chipClassName).not.toContain(
      'facet-chip-active',
    );
    expect(removeQueryContext(input, 'fit:oversized')).toEqual({
      query: 'Siyah tişört göster',
      category: 'tshirt',
      attributes: { color: ['black'] },
    });
  });
});
