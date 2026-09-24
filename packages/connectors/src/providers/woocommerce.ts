import {
  type SourceRow,
  sourceRowSchema,
  type CatalogAttribute,
} from '@shopai/contracts';
import {
  ConnectorHttpError,
  type ConnectorHttpDiagnostics,
  type ConnectorPage,
  type LiveCatalogConnector,
} from '../live.js';
import { createPublicConnectorFetch } from '../target-safety.js';

export type WooCommerceCredentials = {
  storeUrl: string;
  consumerKey: string;
  consumerSecret: string;
};

type WooProduct = {
  id: number;
  type?: string;
  name: string;
  description?: string;
  permalink: string;
  price: string;
  status: string;
  stock_status?: string;
  date_modified_gmt: string;
  categories?: Array<{ id?: number; slug?: string; name?: string }>;
  images?: Array<{ src?: string; alt?: string }>;
  attributes?: Array<{
    name?: string;
    options?: string[];
    variation?: boolean;
  }>;
};

type WooVariation = {
  id: number;
  price: string;
  stock_status?: string;
  date_modified_gmt: string;
  attributes?: Array<{ name?: string; option?: string }>;
  image?: { src?: string; alt?: string };
};

type FetchLike = typeof fetch;
type Sleep = (milliseconds: number) => Promise<void>;
const safeConnectorFetch = createPublicConnectorFetch();
const DIAGNOSTIC_BODY_LIMIT = 1024;

export class WooCommerceConnector implements LiveCatalogConnector {
  readonly provider = 'woocommerce' as const;
  readonly capabilities = {
    liveInventory: true,
    incrementalSync: true,
  } as const;
  private readonly baseUrl: URL;
  private currencyPromise?: Promise<'TRY'>;

  constructor(
    private readonly credentials: WooCommerceCredentials,
    private readonly fetcher: FetchLike = safeConnectorFetch,
    private readonly sleep: Sleep = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
    private readonly maxAttempts = 3,
    private readonly currencyResolver?: () => Promise<string>,
  ) {
    this.baseUrl = new URL(credentials.storeUrl);
    if (this.baseUrl.protocol !== 'https:')
      throw new Error('WooCommerce mağaza adresi HTTPS olmalıdır.');
  }

  async validate() {
    const url = this.apiUrl('products');
    url.searchParams.set('per_page', '1');
    await this.request(url);
    await this.resolveCurrency();
  }

  async readPage(input: {
    cursor?: string | null;
    modifiedAfter?: string | null;
    mode: 'full' | 'incremental';
  }): Promise<ConnectorPage> {
    const page = input.cursor ? Number(input.cursor) : 1;
    if (!Number.isSafeInteger(page) || page < 1)
      throw new Error('Geçersiz WooCommerce sayfa cursor değeri.');
    const url = this.apiUrl('products');
    url.searchParams.set('page', String(page));
    url.searchParams.set('per_page', '100');
    url.searchParams.set('status', 'publish');
    url.searchParams.set('orderby', 'id');
    url.searchParams.set('order', 'asc');
    if (input.mode === 'incremental' && input.modifiedAfter)
      url.searchParams.set('modified_after', input.modifiedAfter);
    const response = await this.request(url);
    const products = (await response.json()) as WooProduct[];
    const totalPagesHeader = response.headers.get('x-wp-totalpages');
    const totalPages = Number(totalPagesHeader ?? '1');
    const isEmptyIncrementalResult =
      input.mode === 'incremental' &&
      page === 1 &&
      products.length === 0 &&
      totalPagesHeader === '0';
    if (
      !Number.isSafeInteger(totalPages) ||
      (totalPages < 1 && !isEmptyIncrementalResult)
    )
      throw new Error('WooCommerce geçersiz sayfalama bilgisi döndürdü.');
    const currency = products.length ? await this.resolveCurrency() : 'TRY';
    const rows: SourceRow[] = [];
    let variationPagesComplete = true;
    const sourceTimes = products.map((product) =>
      isoUtc(product.date_modified_gmt),
    );
    for (const product of products) {
      if (product.type === 'variable') {
        const variationResult = await this.readVariations(product.id);
        const variations = variationResult.rows;
        if (!variations.length)
          throw new Error(
            `WooCommerce variable ürün ${product.id} için varyant bulunamadı.`,
          );
        for (const variation of variations) {
          rows.push(toVariationSourceRow(product, variation, currency));
          sourceTimes.push(isoUtc(variation.date_modified_gmt));
        }
        if (!variationResult.complete) {
          variationPagesComplete = false;
          break;
        }
      } else {
        rows.push(toSimpleSourceRow(product, currency));
      }
    }
    const fetchedAt = new Date().toISOString();
    const sourceObservedAt = products.length
      ? (sourceTimes.sort().at(-1) ?? fetchedAt)
      : (input.modifiedAfter ?? fetchedAt);
    return {
      rows,
      nextCursor:
        variationPagesComplete && page < totalPages ? String(page + 1) : null,
      sourceObservedAt,
      fetchedAt,
      complete:
        variationPagesComplete &&
        page >= totalPages &&
        (input.mode === 'incremental' || totalPagesHeader !== null),
    };
  }

  private apiUrl(path: string) {
    return new URL(`/wp-json/wc/v3/${path}`, this.baseUrl);
  }

  private resolveCurrency() {
    this.currencyPromise ??= (async () => {
      const settings = this.currencyResolver
        ? await this.currencyResolver()
        : (
            (await (
              await this.request(this.apiUrl('settings/general'))
            ).json()) as Array<{ id?: string; value?: unknown }>
          ).find((setting) => setting.id === 'woocommerce_currency')?.value;
      if (settings !== 'TRY')
        throw new Error(
          `WooCommerce para birimi desteklenmiyor veya doğrulanamadı: ${String(settings)}`,
        );
      return 'TRY' as const;
    })();
    return this.currencyPromise;
  }

  private async readVariations(productId: number) {
    const variations: WooVariation[] = [];
    let expectedTotalPages: number | null = null;
    for (let page = 1; page <= 100; page += 1) {
      const url = this.apiUrl(`products/${productId}/variations`);
      url.searchParams.set('page', String(page));
      url.searchParams.set('per_page', '100');
      url.searchParams.set('orderby', 'id');
      url.searchParams.set('order', 'asc');
      const response = await this.request(url);
      const batch = (await response.json()) as WooVariation[];
      variations.push(...batch);
      const totalPagesHeader = response.headers.get('x-wp-totalpages');
      const totalPages = Number(totalPagesHeader);
      if (
        totalPagesHeader === null ||
        !Number.isSafeInteger(totalPages) ||
        totalPages < 1 ||
        totalPages > 100 ||
        (expectedTotalPages !== null && totalPages !== expectedTotalPages) ||
        (page < totalPages && batch.length === 0)
      )
        return { rows: variations, complete: false };
      expectedTotalPages = totalPages;
      if (page >= totalPages) return { rows: variations, complete: true };
    }
    return { rows: variations, complete: false };
  }

  private async request(url: URL) {
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetcher(url, {
          redirect: 'manual',
          headers: {
            authorization: `Basic ${Buffer.from(`${this.credentials.consumerKey}:${this.credentials.consumerSecret}`).toString('base64')}`,
            accept: 'application/json',
          },
          signal: AbortSignal.timeout(15_000),
        });
      } catch (error) {
        if (attempt === this.maxAttempts) throw error;
        await this.sleep(Math.min(5000, 250 * 2 ** (attempt - 1)));
        continue;
      }
      if (response.ok) return response;
      const retryAfter = Number(response.headers.get('retry-after'));
      const diagnostics = await collectHttpDiagnostics(
        response,
        this.credentials,
      );
      const error = new ConnectorHttpError(
        response.status,
        `WooCommerce HTTP ${response.status}`,
        Number.isFinite(retryAfter)
          ? Math.min(30_000, retryAfter * 1000)
          : undefined,
        diagnostics,
      );
      if (!error.retryable || attempt === this.maxAttempts) throw error;
      await this.sleep(
        error.retryAfterMs ?? Math.min(5000, 250 * 2 ** (attempt - 1)),
      );
    }
    throw new Error('WooCommerce isteği tamamlanamadı.');
  }
}

function toSimpleSourceRow(product: WooProduct, currency: 'TRY'): SourceRow {
  const attribute = (name: RegExp) =>
    product.attributes?.find((item) => name.test(item.name ?? ''))
      ?.options?.[0];
  const price = Number(product.price.replace(',', '.'));
  const options = optionAttributes(
    product.attributes
      ?.filter((item) => item.variation === true)
      .flatMap((item) =>
        item.options?.length === 1
          ? [{ name: item.name, option: item.options[0] }]
          : [],
      ) ?? [],
  );
  return sourceRowSchema.parse({
    externalId: String(product.id),
    productKey: String(product.id),
    title: product.name,
    description: stripHtml(product.description ?? ''),
    category:
      product.categories?.[0]?.slug ??
      product.categories?.[0]?.name ??
      'uncategorized',
    imageUrl: product.images?.[0]?.src ?? null,
    imageAlt: product.images?.[0]?.alt || product.name,
    productAttributes: productAttributes(product),
    ...(options.length ? { variantOptions: options } : {}),
    sourceCategoryId: product.categories?.[0]?.id?.toString(),
    size: attribute(/size|beden/iu) ?? 'ONE_SIZE',
    color: attribute(/colou?r|renk/iu) ?? 'unspecified',
    priceMinor: Math.round(price * 100),
    currency,
    available:
      product.stock_status === 'instock'
        ? true
        : product.stock_status === 'outofstock'
          ? false
          : null,
    checkoutUrl: product.permalink,
  });
}

function toVariationSourceRow(
  product: WooProduct,
  variation: WooVariation,
  currency: 'TRY',
): SourceRow {
  const attribute = (name: RegExp, fallback: string) => {
    const selected = variation.attributes?.find((item) =>
      name.test(item.name ?? ''),
    )?.option;
    if (selected) return selected;
    const options = product.attributes?.find((item) =>
      name.test(item.name ?? ''),
    )?.options;
    if (!options?.length) return fallback;
    if (options.length === 1 && options[0]) return options[0];
    throw new Error(
      `WooCommerce varyant ${variation.id} için ${name.source} niteliği belirsiz.`,
    );
  };
  const price = Number(variation.price.replace(',', '.'));
  const options = optionAttributes(variation.attributes ?? []);
  return sourceRowSchema.parse({
    externalId: String(variation.id),
    productKey: String(product.id),
    title: product.name,
    description: stripHtml(product.description ?? ''),
    category:
      product.categories?.[0]?.slug ??
      product.categories?.[0]?.name ??
      'uncategorized',
    imageUrl: product.images?.[0]?.src ?? null,
    variantImageUrl: variation.image?.src ?? null,
    variantImageAlt: variation.image?.alt ?? null,
    imageAlt: product.images?.[0]?.alt || product.name,
    productAttributes: productAttributes(product),
    ...(options.length ? { variantOptions: options } : {}),
    sourceCategoryId: product.categories?.[0]?.id?.toString(),
    size: attribute(/size|beden/iu, 'ONE_SIZE'),
    color: attribute(/colou?r|renk/iu, 'unspecified'),
    priceMinor: Math.round(price * 100),
    currency,
    available:
      variation.stock_status === 'instock'
        ? true
        : variation.stock_status === 'outofstock'
          ? false
          : null,
    checkoutUrl: product.permalink,
  });
}

function optionAttributes(
  items: Array<{ name?: string; option?: string }>,
): CatalogAttribute[] {
  return items
    .filter((item): item is { name: string; option: string } =>
      Boolean(item.name?.trim() && item.option?.trim()),
    )
    .map((item) => attribute(item.name, item.option));
}

function productAttributes(product: WooProduct): CatalogAttribute[] {
  return (product.attributes ?? []).flatMap((item) => {
    if (item.variation === true || !item.name?.trim() || !item.options?.length)
      return [];
    return [
      {
        ...attribute(item.name, item.options.join(' | ')),
        rawValues: item.options,
      },
    ];
  });
}

function attribute(name: string, rawValue: string): CatalogAttribute {
  const key = name.trim().toLocaleLowerCase('en-US').replace(/\s+/gu, '_');
  const match = rawValue
    .trim()
    .match(/^([0-9]+(?:[.,][0-9]+)?)\s+([\p{L}%]+)$/u);
  return {
    key,
    label: name.trim(),
    value: match?.[1] ?? rawValue.trim(),
    ...(match ? { unit: match[2], rawValue: rawValue.trim() } : {}),
    sourceKey: name,
  };
}

async function collectHttpDiagnostics(
  response: Response,
  credentials: WooCommerceCredentials,
): Promise<ConnectorHttpDiagnostics> {
  const body = await response.text().catch(() => '');
  return compactDiagnostics({
    contentType: cleanDiagnosticValue(response.headers.get('content-type')),
    upstreamServer: cleanDiagnosticValue(response.headers.get('server')),
    retryAfter: cleanDiagnosticValue(response.headers.get('retry-after'), 64),
    cfRay: cleanDiagnosticValue(response.headers.get('cf-ray'), 128),
    requestId: firstDiagnosticHeader(response.headers, [
      'x-request-id',
      'request-id',
      'x-correlation-id',
      'x-amzn-requestid',
      'x-amz-cf-id',
    ]),
    responseBodySnippet: sanitizeDiagnosticBody(body, credentials),
  });
}

function compactDiagnostics(
  value: ConnectorHttpDiagnostics,
): ConnectorHttpDiagnostics {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as ConnectorHttpDiagnostics;
}

function firstDiagnosticHeader(headers: Headers, names: string[]) {
  for (const name of names) {
    const value = cleanDiagnosticValue(headers.get(name));
    if (value) return value;
  }
  return undefined;
}

function cleanDiagnosticValue(value: string | null, limit = 256) {
  if (!value) return undefined;
  const cleaned = replaceControlCharacters(value).trim();
  return cleaned ? cleaned.slice(0, limit) : undefined;
}

function sanitizeDiagnosticBody(
  value: string,
  credentials: WooCommerceCredentials,
) {
  let sanitized = value;
  const basicCredential = Buffer.from(
    `${credentials.consumerKey}:${credentials.consumerSecret}`,
  ).toString('base64');
  const sensitiveValues = [
    credentials.consumerKey,
    credentials.consumerSecret,
    encodeURIComponent(credentials.consumerKey),
    encodeURIComponent(credentials.consumerSecret),
    basicCredential,
  ].filter(Boolean);
  for (const secret of sensitiveValues)
    sanitized = sanitized.split(secret).join('[REDACTED]');
  sanitized = replaceControlCharacters(sanitized)
    .replace(/Basic\s+[A-Za-z0-9+/=]+/giu, 'Basic [REDACTED]')
    .replace(/\s+/gu, ' ')
    .trim();
  return sanitized ? sanitized.slice(0, DIAGNOSTIC_BODY_LIMIT) : undefined;
}

function replaceControlCharacters(value: string) {
  let output = '';
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    output +=
      codePoint !== undefined && (codePoint < 32 || codePoint === 127)
        ? ' '
        : character;
  }
  return output;
}

function isoUtc(value: string) {
  return value.endsWith('Z') ? value : `${value}Z`;
}

function stripHtml(value: string) {
  return value
    .replace(/<[^>]*>/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}
