import { randomUUID } from 'node:crypto';
import {
  type CatalogItem,
  type ParserTelemetry,
  type SearchFacets,
  type SearchRequest,
  type SearchResponse,
  type StockStatus,
  searchRequestSchema,
} from '@shopai/contracts';

export * from './redirects.js';

export type ResolvedSearchRequest = SearchRequest & {
  textTerms: string[];
  matchNone: boolean;
};
export type CatalogSearchPage = {
  items: CatalogItem[];
  nextCursor: string | null;
  facets: SearchFacets;
};
export interface CatalogRepository {
  search(request: ResolvedSearchRequest): Promise<CatalogSearchPage>;
  health(): Promise<void>;
}
export interface QueryParser {
  parse(query: string): Promise<{
    filters: Partial<SearchRequest['filters']>;
    warnings: string[];
    telemetry: ParserTelemetry;
  }>;
}
export const COLOR_ALIASES: Readonly<Record<string, string>> = {
  siyah: 'black',
  kara: 'black',
  black: 'black',
  beyaz: 'white',
  white: 'white',
  lacivert: 'navy',
  navy: 'navy',
  mavi: 'blue',
  blue: 'blue',
  kirmizi: 'red',
  red: 'red',
  yesil: 'green',
  green: 'green',
};
export const SIZE_ALIASES: Readonly<Record<string, string>> = {
  xs: 'XS',
  s: 'S',
  small: 'S',
  kucuk: 'S',
  m: 'M',
  medium: 'M',
  orta: 'M',
  l: 'L',
  large: 'L',
  buyuk: 'L',
  xl: 'XL',
  xxl: 'XXL',
};
export const CATEGORY_ALIASES: Readonly<Record<string, string>> = {
  tisort: 'tshirt',
  tshirt: 'tshirt',
  't-shirt': 'tshirt',
  gomlek: 'shirt',
  shirt: 'shirt',
  pantolon: 'trousers',
  trousers: 'trousers',
  ceket: 'jacket',
  jacket: 'jacket',
};

export const normalizeTurkish = (value: string) =>
  value
    .trim()
    .toLocaleLowerCase('tr-TR')
    .replaceAll('ı', 'i')
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^a-z0-9-]+/gu, ' ')
    .trim();

export const normalize = normalizeTurkish;
function editDistance(left: string, right: string) {
  let previousPrevious: number[] | undefined;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= right.length; j += 1) {
      let distance = Math.min(
        (previous[j] ?? j) + 1,
        (current[j - 1] ?? i) + 1,
        (previous[j - 1] ?? i - 1) + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
      if (
        i > 1 &&
        j > 1 &&
        left[i - 1] === right[j - 2] &&
        left[i - 2] === right[j - 1]
      )
        distance = Math.min(
          distance,
          (previousPrevious?.[j - 2] ?? Number.POSITIVE_INFINITY) + 1,
        );
      current[j] = distance;
    }
    previousPrevious = previous;
    previous = current;
  }
  return previous[right.length] ?? left.length;
}
function aliasValue(aliases: Readonly<Record<string, string>>, value: string) {
  const normalized = normalizeTurkish(value);
  const exact = aliases[normalized];
  if (exact) return exact;
  if (normalized.length < 4) return normalized;
  const candidates = Object.entries(aliases).filter(
    ([alias]) => editDistance(normalized, normalizeTurkish(alias)) === 1,
  );
  const values = [...new Set(candidates.map(([, canonical]) => canonical))];
  return values.length === 1 ? (values[0] ?? normalized) : normalized;
}
export const normalizeColor = (value: string) => {
  return aliasValue(COLOR_ALIASES, value);
};
export const normalizeSize = (value: string) => {
  const normalized = normalizeTurkish(value);
  return SIZE_ALIASES[normalized] ?? value.trim().toUpperCase();
};
export const normalizeCategory = (value: string) => {
  return aliasValue(CATEGORY_ALIASES, value);
};

const QUERY_STOP_WORDS = new Set([
  'ara',
  'ariyorum',
  'beden',
  'bir',
  'icin',
  'istiyorum',
  'urun',
  'tl',
  'altinda',
  'alti',
  'gecmesin',
  'ust',
  'ile',
  'arasi',
  'arasinda',
  'stokta',
  'stoklu',
  'hemen',
  'teslim',
  'sinir',
  'olmayan',
  'olmasin',
  'degil',
  'haric',
  'istemiyorum',
]);

export function extractSearchTerms(
  query: string,
  filters: SearchRequest['filters'],
) {
  const colors = new Set(filters.colors.map(normalizeColor));
  const excludedColors = new Set(filters.excludedColors.map(normalizeColor));
  const sizes = new Set(filters.sizes.map(normalizeSize));
  const excludedSizes = new Set(filters.excludedSizes.map(normalizeSize));
  const category = filters.category
    ? normalizeCategory(filters.category)
    : undefined;
  return normalizeTurkish(query)
    .split(/\s+/u)
    .filter(Boolean)
    .filter((token) => !QUERY_STOP_WORDS.has(token))
    .filter((token) => !/^\d+(?:[.,]\d+)?$/u.test(token))
    .filter((token) => !colors.has(normalizeColor(token)))
    .filter((token) => !excludedColors.has(normalizeColor(token)))
    .filter((token) => !sizes.has(normalizeSize(token)))
    .filter((token) => !excludedSizes.has(normalizeSize(token)))
    .filter((token) => !category || normalizeCategory(token) !== category);
}

export const STOCK_STALE_AFTER_MS = 15 * 60 * 1000;
// The five-minute worker scheduler starts a verified full read before public
// inventory reaches the stale boundary. Incremental empty responses do not
// constitute stock verification.
export const STOCK_REVALIDATE_AFTER_MS = 10 * 60 * 1000;
export function stockStatus(
  available: boolean | null,
  observedAt: string | null,
  now = Date.now(),
): StockStatus {
  if (!observedAt) return 'unknown';
  if (now - new Date(observedAt).getTime() > STOCK_STALE_AFTER_MS)
    return 'stale';
  if (available === null) return 'unknown';
  return available ? 'in_stock' : 'out_of_stock';
}

type Cursor = { priceMinor: number; offerId: string };
export function encodeSearchCursor(cursor: Cursor) {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}
export function decodeSearchCursor(
  value: string | null | undefined,
): Cursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8'),
    ) as Partial<Cursor> | undefined;
    if (
      !parsed ||
      !Number.isSafeInteger(parsed.priceMinor) ||
      typeof parsed.offerId !== 'string' ||
      !/^[0-9a-f-]{36}$/iu.test(parsed.offerId)
    )
      throw new Error('invalid');
    return parsed as Cursor;
  } catch {
    throw Object.assign(new Error('Geçersiz arama cursor değeri.'), {
      statusCode: 400,
    });
  }
}

function facets(items: readonly CatalogItem[]): SearchFacets {
  const collect = (values: string[]) =>
    [
      ...values.reduce((counts, value) => {
        counts.set(value, (counts.get(value) ?? 0) + 1);
        return counts;
      }, new Map<string, number>()),
    ]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => a.value.localeCompare(b.value, 'tr-TR'));
  return {
    categories: collect(items.map((item) => item.category)),
    sizes: collect(items.map((item) => item.size)),
    colors: collect(items.map((item) => item.color)),
  };
}

export class SearchProducts {
  constructor(
    private readonly repository: CatalogRepository,
    private readonly parser: QueryParser,
    private readonly mode: SearchResponse['mode'],
  ) {}
  async execute(
    input: unknown,
    context: { merchantIds?: string[] } = {},
  ): Promise<SearchResponse> {
    // Preserve explicit input fields so parser hints never override UI choices.
    const raw = searchRequestSchema.partial().parse(input);
    const request = searchRequestSchema.parse(input);
    const hints = request.query
      ? await this.parser.parse(request.query)
      : {
          filters: {},
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
        };
    const original = input as { filters?: Partial<SearchRequest['filters']> };
    const filters = {
      ...request.filters,
      ...hints.filters,
      ...original.filters,
    };
    if (original.filters?.colors)
      filters.excludedColors = (filters.excludedColors ?? []).filter(
        (color) =>
          !original.filters?.colors?.some(
            (selected) => normalizeColor(selected) === normalizeColor(color),
          ),
      );
    if (original.filters?.sizes)
      filters.excludedSizes = (filters.excludedSizes ?? []).filter(
        (size) =>
          !original.filters?.sizes?.some(
            (selected) => normalizeSize(selected) === normalizeSize(size),
          ),
      );
    if (original.filters?.category)
      filters.excludedCategories = (filters.excludedCategories ?? []).filter(
        (category) =>
          normalizeCategory(category) !==
          normalizeCategory(original.filters?.category ?? ''),
      );
    const scopedMerchantIds = context.merchantIds
      ? request.merchantIds.length
        ? request.merchantIds.filter((id) => context.merchantIds?.includes(id))
        : context.merchantIds
      : request.merchantIds;
    const parsed = searchRequestSchema.parse({
      ...raw,
      ...request,
      filters,
      merchantIds: scopedMerchantIds,
    });
    if (
      parsed.filters.minPriceMinor !== undefined &&
      parsed.filters.maxPriceMinor !== undefined &&
      parsed.filters.minPriceMinor > parsed.filters.maxPriceMinor
    )
      throw new Error('Alt fiyat üst fiyattan büyük olamaz.');
    const page = await this.repository.search({
      ...parsed,
      textTerms: extractSearchTerms(parsed.query, parsed.filters),
      matchNone: Boolean(
        context.merchantIds &&
          request.merchantIds.length &&
          !scopedMerchantIds.length,
      ),
    });
    return {
      schemaVersion: 1,
      searchId: randomUUID(),
      ...page,
      appliedFilters: parsed.filters,
      warnings: hints.warnings,
      telemetry: hints.telemetry,
      mode: this.mode,
    };
  }
}

export type MemoryRecord = CatalogItem & {
  published: boolean;
  merchantActive: boolean;
  offerActive: boolean;
};
export class MemoryCatalogRepository implements CatalogRepository {
  constructor(private readonly records: readonly MemoryRecord[]) {}
  async health(): Promise<void> {}
  async search({
    query: _query,
    filters: f,
    merchantIds,
    limit,
    cursor,
    textTerms,
    matchNone,
  }: ResolvedSearchRequest): Promise<CatalogSearchPage> {
    const after = decodeSearchCursor(cursor);
    const matching = this.records
      .map((record) => ({
        ...record,
        stockStatus: stockStatus(record.available, record.stockObservedAt),
      }))
      .filter(() => !matchNone)
      .filter((r) => r.published && r.merchantActive && r.offerActive)
      .filter((r) => !merchantIds.length || merchantIds.includes(r.merchantId))
      .filter((r) => {
        const searchable = normalizeTurkish(`${r.title} ${r.description}`);
        return textTerms.every((term) => searchable.includes(term));
      })
      .filter(
        (r) =>
          !f.category ||
          normalizeCategory(r.category) === normalizeCategory(f.category),
      )
      .filter(
        (r) =>
          !f.excludedCategories.some(
            (category) =>
              normalizeCategory(category) === normalizeCategory(r.category),
          ),
      )
      .filter(
        (r) =>
          !f.sizes.length ||
          f.sizes.some((s) => normalizeSize(s) === normalizeSize(r.size)),
      )
      .filter(
        (r) =>
          !f.excludedSizes.some(
            (size) => normalizeSize(size) === normalizeSize(r.size),
          ),
      )
      .filter(
        (r) =>
          !f.colors.length ||
          f.colors.some((c) => normalizeColor(c) === normalizeColor(r.color)),
      )
      .filter(
        (r) =>
          !f.excludedColors.some(
            (color) => normalizeColor(color) === normalizeColor(r.color),
          ),
      )
      .filter(
        (r) =>
          r.currency === f.currency &&
          (f.minPriceMinor === undefined || r.priceMinor >= f.minPriceMinor) &&
          (f.maxPriceMinor === undefined || r.priceMinor <= f.maxPriceMinor),
      )
      .filter((r) => !f.inStockOnly || r.stockStatus === 'in_stock')
      .sort(
        (a, b) =>
          a.priceMinor - b.priceMinor || a.offerId.localeCompare(b.offerId),
      );
    const pageRows = matching
      .filter(
        (item) =>
          !after ||
          item.priceMinor > after.priceMinor ||
          (item.priceMinor === after.priceMinor &&
            item.offerId.localeCompare(after.offerId) > 0),
      )
      .slice(0, limit + 1);
    const hasMore = pageRows.length > limit;
    const items = pageRows
      .slice(0, limit)
      .map(
        ({
          published: _published,
          merchantActive: _merchant,
          offerActive: _offer,
          ...item
        }) => item,
      );
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        hasMore && last
          ? encodeSearchCursor({
              priceMinor: last.priceMinor,
              offerId: last.offerId,
            })
          : null,
      facets: facets(matching),
    };
  }
}

export const DEMO_MERCHANT_ID = '10000000-0000-4000-8000-000000000001';
export const DEMO_CONNECTION_ID = '10000000-0000-4000-8000-000000000002';
const demoObservedAt = new Date().toISOString();
export const demoRecords: MemoryRecord[] = [
  ['1', 'Minimal Siyah Tişört', 'M', 'black', 89900, true],
  ['2', 'Minimal Siyah Tişört', 'L', 'black', 89900, false],
  ['3', 'Günlük Beyaz Tişört', 'M', 'white', 69900, true],
  ['4', 'Lacivert Tişört', 'S', 'navy', 109900, true],
].map(([id, title, size, color, price, available]) => ({
  productId: `20000000-0000-4000-8000-00000000000${id === '2' ? '1' : id}`,
  variantId: `30000000-0000-4000-8000-00000000000${id}`,
  offerId: `40000000-0000-4000-8000-00000000000${id}`,
  merchantId: DEMO_MERCHANT_ID,
  merchantName: 'Demo Mağaza',
  title: String(title),
  description:
    'Sentetik geliştirme ürünü; gerçek satış veya canlı stok değildir.',
  category: 'tshirt',
  imageUrl: null,
  imageAlt: null,
  size: String(size),
  color: String(color),
  priceMinor: Number(price),
  currency: 'TRY',
  available: Boolean(available),
  stockStatus: available ? 'in_stock' : 'out_of_stock',
  priceSource: 'demo-seed',
  stockSource: 'demo-seed',
  priceObservedAt: demoObservedAt,
  stockObservedAt: demoObservedAt,
  observedAt: demoObservedAt,
  checkoutUrl: `https://example.com/products/${id}`,
  published: true,
  merchantActive: true,
  offerActive: true,
}));
