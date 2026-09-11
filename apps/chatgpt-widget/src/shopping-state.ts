import type {
  SearchProductsRequest,
  SearchProductsResponse,
} from '@shopai/contracts/search-products';

export const WIDGET_VIEWS = {
  CATEGORY_SELECT: 'CATEGORY_SELECT',
  PRODUCT_GRID: 'PRODUCT_GRID',
  PRODUCT_DETAIL: 'PRODUCT_DETAIL',
} as const;

export type WidgetView = (typeof WIDGET_VIEWS)[keyof typeof WIDGET_VIEWS];
export type QuickAttribute = 'color' | 'size';

const ATTRIBUTE_ALIASES: Record<QuickAttribute, readonly string[]> = {
  color: ['color', 'colors'],
  size: ['size', 'sizes'],
};

const QUERY_CONTEXTS = [
  {
    id: 'fit:oversized',
    label: 'Oversize',
    patterns: [/\boversized\b/giu, /\boversize\b/giu],
  },
  { id: 'fit:slim', label: 'Slim', patterns: [/\bslim(?:\s+fit)?\b/giu] },
  {
    id: 'fit:regular',
    label: 'Regular',
    patterns: [/\bregular(?:\s+fit)?\b/giu],
  },
] as const;

function values(value: string | string[] | undefined) {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

export function selectedAttributeValues(
  input: SearchProductsRequest,
  attribute: QuickAttribute,
) {
  return [
    ...new Set(
      ATTRIBUTE_ALIASES[attribute].flatMap((key) =>
        values(input.attributes?.[key]),
      ),
    ),
  ];
}

export function toggleAttributeFilter(
  input: SearchProductsRequest,
  attribute: QuickAttribute,
  value: string,
): SearchProductsRequest {
  const current = selectedAttributeValues(input, attribute);
  const next = current.includes(value)
    ? current.filter((item) => item !== value)
    : [...current, value];
  const attributes = { ...(input.attributes ?? {}) };
  for (const key of ATTRIBUTE_ALIASES[attribute]) delete attributes[key];
  if (next.length) attributes[attribute] = next;
  const { cursor: _cursor, ...withoutCursor } = input;
  return {
    ...withoutCursor,
    ...(Object.keys(attributes).length ? { attributes } : { attributes: {} }),
  };
}

export function selectCategory(
  input: SearchProductsRequest,
  category?: string,
): SearchProductsRequest {
  const { cursor: _cursor, category: _category, ...withoutCategory } = input;
  return {
    ...withoutCategory,
    ...(category ? { category } : {}),
  };
}

export function clearPriceFilter(
  input: SearchProductsRequest,
): SearchProductsRequest {
  const { cursor: _cursor, price: _price, ...withoutPrice } = input;
  return withoutPrice;
}

export type QueryContextChip = {
  id: string;
  label: string;
};

export function queryContextChips(query?: string): QueryContextChip[] {
  if (!query) return [];
  return QUERY_CONTEXTS.filter((context) =>
    context.patterns.some((pattern) => {
      pattern.lastIndex = 0;
      return pattern.test(query);
    }),
  ).map(({ id, label }) => ({ id, label }));
}

export function removeQueryContext(
  input: SearchProductsRequest,
  id: string,
): SearchProductsRequest {
  const context = QUERY_CONTEXTS.find((item) => item.id === id);
  if (!context || !input.query) return input;
  let query = input.query;
  for (const pattern of context.patterns) {
    pattern.lastIndex = 0;
    query = query.replace(pattern, ' ');
  }
  query = query.replace(/\s+/gu, ' ').trim();
  const { cursor: _cursor, query: _query, ...withoutQuery } = input;
  return {
    ...withoutQuery,
    ...(query ? { query } : {}),
  };
}

export function resolveWidgetView(input: {
  request: SearchProductsRequest;
  result?: SearchProductsResponse;
  hasDetail: boolean;
}): WidgetView {
  if (input.hasDetail) return WIDGET_VIEWS.PRODUCT_DETAIL;
  if (
    input.result &&
    !input.request.category &&
    input.result.facets.categories.length > 1
  )
    return WIDGET_VIEWS.CATEGORY_SELECT;
  return WIDGET_VIEWS.PRODUCT_GRID;
}
