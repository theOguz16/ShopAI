import { type SourceRow, sourceRowSchema } from '@shopai/contracts';
import {
  ConnectorHttpError,
  type ConnectorHttpDiagnostics,
  type ConnectorPage,
  type LiveCatalogConnector,
} from '../live.js';
import { createPublicConnectorFetch } from '../target-safety.js';

export type TrendyolEnvironment = 'production' | 'stage';

export type TrendyolCredentials = {
  sellerId: string;
  apiKey: string;
  apiSecret: string;
  environment?: TrendyolEnvironment;
  integrationName?: string;
  storeFrontCode?: string;
};

type TrendyolAttribute = {
  attributeName?: string;
  attributeValue?: string;
};

type TrendyolVariant = {
  variantId?: number | string;
  barcode?: string;
  attributes?: TrendyolAttribute[];
  productUrl?: string;
  onSale?: boolean;
  stock?: {
    quantity?: number;
    lastModifiedDate?: number | null;
  };
  price?: {
    salePrice?: number;
    listPrice?: number;
    priceSeenByCustomer?: number;
  };
  sellerModifiedDate?: number;
  locked?: boolean;
  archived?: boolean;
  blacklisted?: boolean;
};

type TrendyolContent = {
  contentId?: number | string;
  productMainId?: string;
  category?: { id?: number | string; name?: string };
  lastModifiedDate?: number;
  title?: string;
  description?: string;
  images?: Array<{ url?: string }>;
  attributes?: TrendyolAttribute[];
  variants?: TrendyolVariant[];
};

type TrendyolProductsResponse = {
  totalElements?: number;
  totalPages?: number;
  page?: number;
  size?: number;
  nextPageToken?: string | null;
  content?: TrendyolContent[];
};

type FetchLike = typeof fetch;
type Sleep = (milliseconds: number) => Promise<void>;
type Now = () => number;

const safeConnectorFetch = createPublicConnectorFetch();
const PAGE_SIZE = 100;
const MAX_PAGE_OFFSET = 10_000;
const DEFAULT_MIN_REQUEST_INTERVAL_MS = 210;
const DIAGNOSTIC_BODY_LIMIT = 1024;
const PROD_API_ORIGIN = 'https://apigw.trendyol.com';
const STAGE_API_ORIGIN = 'https://stageapigw.trendyol.com';
const PROD_STOREFRONT_ORIGIN = 'https://www.trendyol.com';
const STAGE_STOREFRONT_ORIGIN = 'https://stage.trendyol.com';

type TrendyolCursor =
  | { kind: 'page'; page: number }
  | { kind: 'token'; token: string };

export function parseTrendyolCredentials(input: unknown): TrendyolCredentials {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Trendyol credential payload geçersiz.');
  const value = input as Record<string, unknown>;
  const sellerId =
    typeof value.sellerId === 'number'
      ? String(value.sellerId)
      : typeof value.sellerId === 'string'
        ? value.sellerId.trim()
        : '';
  const apiKey = typeof value.apiKey === 'string' ? value.apiKey.trim() : '';
  const apiSecret =
    typeof value.apiSecret === 'string' ? value.apiSecret.trim() : '';
  const environment = value.environment ?? 'production';
  const integrationName =
    typeof value.integrationName === 'string' && value.integrationName.trim()
      ? value.integrationName.trim()
      : 'ShopAI';
  const storeFrontCode =
    typeof value.storeFrontCode === 'string' && value.storeFrontCode.trim()
      ? value.storeFrontCode.trim()
      : undefined;

  if (!/^\d+$/u.test(sellerId))
    throw new Error('Trendyol sellerId yalnızca rakamlardan oluşmalıdır.');
  if (!apiKey || !apiSecret)
    throw new Error('Trendyol API key ve API secret gereklidir.');
  if (environment !== 'production' && environment !== 'stage')
    throw new Error('Trendyol environment production veya stage olmalıdır.');
  if (!/^[A-Za-z0-9]{1,30}$/u.test(integrationName))
    throw new Error(
      'Trendyol integrationName alfanumerik ve en fazla 30 karakter olmalıdır.',
    );

  return {
    sellerId,
    apiKey,
    apiSecret,
    environment,
    integrationName,
    ...(storeFrontCode ? { storeFrontCode } : {}),
  };
}

export class TrendyolConnector implements LiveCatalogConnector {
  readonly provider = 'trendyol' as const;
  readonly capabilities = {
    liveInventory: true,
    incrementalSync: true,
  } as const;

  private readonly credentials: TrendyolCredentials;
  private readonly apiOrigin: string;
  private readonly storefrontOrigin: string;
  private lastRequestStartedAt = 0;

  constructor(
    credentials: TrendyolCredentials,
    private readonly fetcher: FetchLike = safeConnectorFetch,
    private readonly sleep: Sleep = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
    private readonly maxAttempts = 3,
    private readonly now: Now = () => Date.now(),
    private readonly minRequestIntervalMs = DEFAULT_MIN_REQUEST_INTERVAL_MS,
  ) {
    this.credentials = parseTrendyolCredentials(credentials);
    this.apiOrigin =
      this.credentials.environment === 'stage'
        ? STAGE_API_ORIGIN
        : PROD_API_ORIGIN;
    this.storefrontOrigin =
      this.credentials.environment === 'stage'
        ? STAGE_STOREFRONT_ORIGIN
        : PROD_STOREFRONT_ORIGIN;
    if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1)
      throw new Error('Trendyol maxAttempts en az 1 olmalıdır.');
    if (!Number.isFinite(minRequestIntervalMs) || minRequestIntervalMs < 0)
      throw new Error('Trendyol request interval geçersiz.');
  }

  async validate() {
    const url = this.productsUrl();
    url.searchParams.set('page', '0');
    url.searchParams.set('size', '1');
    await this.request(url);
  }

  async readPage(input: {
    cursor?: string | null;
    modifiedAfter?: string | null;
    mode: 'full' | 'incremental';
  }): Promise<ConnectorPage> {
    const cursor = parseCursor(input.cursor);
    const url = this.productsUrl();
    url.searchParams.set('size', String(PAGE_SIZE));
    if (cursor.kind === 'page')
      url.searchParams.set('page', String(cursor.page));
    else url.searchParams.set('nextPageToken', cursor.token);

    if (input.mode === 'incremental' && input.modifiedAfter) {
      const timestamp = Date.parse(input.modifiedAfter);
      if (!Number.isFinite(timestamp))
        throw new Error('Geçersiz Trendyol incremental watermark değeri.');
      url.searchParams.set('startDate', String(timestamp));
      url.searchParams.set('dateQueryType', 'VARIANT_MODIFIED_DATE');
    }

    const response = await this.request(url);
    const payload = (await response.json()) as TrendyolProductsResponse;
    const content = Array.isArray(payload.content) ? payload.content : null;
    const totalPages = payload.totalPages;
    const responsePage = payload.page;

    if (
      !content ||
      !Number.isSafeInteger(totalPages) ||
      (totalPages as number) < 0 ||
      !Number.isSafeInteger(responsePage) ||
      (responsePage as number) < 0
    )
      throw new Error('Trendyol geçersiz sayfalama bilgisi döndürdü.');
    if (cursor.kind === 'page' && responsePage !== cursor.page)
      throw new Error('Trendyol beklenmeyen sayfa numarası döndürdü.');

    const rows: SourceRow[] = [];
    const sourceTimes: number[] = [];
    for (const item of content) {
      addTimestamp(sourceTimes, item.lastModifiedDate);
      const variants = Array.isArray(item.variants) ? item.variants : [];
      for (const variant of variants) {
        addTimestamp(sourceTimes, variant.sellerModifiedDate);
        addTimestamp(sourceTimes, variant.stock?.lastModifiedDate);
        rows.push(this.toSourceRow(item, variant));
      }
    }

    const hasMore = (responsePage as number) + 1 < (totalPages as number);
    if (hasMore && content.length === 0)
      throw new Error('Trendyol sayfalama devam ederken boş sayfa döndürdü.');
    const nextCursor = hasMore
      ? nextTrendyolCursor(
          cursor,
          responsePage as number,
          payload.nextPageToken,
        )
      : null;
    const fetchedAt = new Date(this.now()).toISOString();
    const sourceObservedAt = sourceTimes.length
      ? new Date(Math.max(...sourceTimes)).toISOString()
      : (input.modifiedAfter ?? fetchedAt);

    return {
      rows,
      nextCursor,
      sourceObservedAt,
      fetchedAt,
      complete: nextCursor === null,
    };
  }

  private productsUrl() {
    return new URL(
      `/integration/product/sellers/${this.credentials.sellerId}/products/approved`,
      this.apiOrigin,
    );
  }

  private toSourceRow(
    content: TrendyolContent,
    variant: TrendyolVariant,
  ): SourceRow {
    const externalId = identifier(variant.variantId ?? variant.barcode);
    const productKey = identifier(content.productMainId ?? content.contentId);
    const title = requiredText(
      content.title,
      'Trendyol ürün başlığı eksik.',
      240,
    );
    const productUrl = requiredHttpsUrl(
      variant.productUrl,
      'Trendyol productUrl eksik veya HTTPS değil.',
    );
    const price = firstFiniteNumber(
      variant.price?.priceSeenByCustomer,
      variant.price?.salePrice,
      variant.price?.listPrice,
    );
    if (price === null || price < 0)
      throw new Error(`Trendyol varyant ${externalId} için fiyat geçersiz.`);

    const contentAttribute = (pattern: RegExp) =>
      content.attributes?.find((item) => pattern.test(item.attributeName ?? ''))
        ?.attributeValue;
    const variantAttribute = (pattern: RegExp) =>
      variant.attributes?.find((item) => pattern.test(item.attributeName ?? ''))
        ?.attributeValue;
    const category =
      cleanText(content.category?.name, 80) ||
      cleanText(identifierOrEmpty(content.category?.id), 80) ||
      'uncategorized';
    const rawImageUrl = content.images?.find((image) => image.url)?.url;
    const imageUrl = rawImageUrl
      ? resolveHttpsUrl(rawImageUrl, this.storefrontOrigin)
      : null;
    const unavailable =
      variant.archived === true ||
      variant.blacklisted === true ||
      variant.locked === true;
    const quantity = variant.stock?.quantity;
    const available = unavailable
      ? false
      : typeof quantity === 'number' && Number.isFinite(quantity)
        ? quantity > 0
        : variant.onSale === false
          ? false
          : null;

    return sourceRowSchema.parse({
      externalId,
      productKey,
      title,
      description: cleanDescription(content.description ?? ''),
      category,
      imageUrl,
      imageAlt: title,
      size:
        cleanText(
          variantAttribute(/beden|size/iu) ?? contentAttribute(/beden|size/iu),
          20,
        ) || 'ONE_SIZE',
      color:
        cleanText(
          variantAttribute(/renk|colou?r/iu) ??
            contentAttribute(/renk|colou?r/iu),
          40,
        ) || 'unspecified',
      priceMinor: Math.round(price * 100),
      currency: 'TRY',
      available,
      checkoutUrl: productUrl,
    });
  }

  private async waitForRateLimit() {
    if (this.lastRequestStartedAt === 0 || this.minRequestIntervalMs === 0) {
      this.lastRequestStartedAt = this.now();
      return;
    }
    const waitMs = Math.max(
      0,
      this.lastRequestStartedAt + this.minRequestIntervalMs - this.now(),
    );
    if (waitMs > 0) await this.sleep(waitMs);
    this.lastRequestStartedAt = this.now();
  }

  private async request(url: URL) {
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      await this.waitForRateLimit();
      let response: Response;
      try {
        response = await this.fetcher(url, {
          redirect: 'manual',
          headers: {
            authorization: `Basic ${Buffer.from(`${this.credentials.apiKey}:${this.credentials.apiSecret}`).toString('base64')}`,
            'user-agent': `${this.credentials.sellerId} - ${this.credentials.integrationName ?? 'ShopAI'}`,
            accept: 'application/json',
            ...(this.credentials.storeFrontCode
              ? { storeFrontCode: this.credentials.storeFrontCode }
              : {}),
          },
          signal: AbortSignal.timeout(15_000),
        });
      } catch (error) {
        if (attempt === this.maxAttempts) throw error;
        await this.sleep(Math.min(5000, 250 * 2 ** (attempt - 1)));
        continue;
      }
      if (response.ok) return response;
      const diagnostics = await collectHttpDiagnostics(
        response,
        this.credentials,
      );
      const error = new ConnectorHttpError(
        response.status,
        `Trendyol HTTP ${response.status}`,
        retryAfterMilliseconds(response.headers.get('retry-after'), this.now()),
        diagnostics,
      );
      if (!error.retryable || attempt === this.maxAttempts) throw error;
      await this.sleep(
        error.retryAfterMs ?? Math.min(5000, 250 * 2 ** (attempt - 1)),
      );
    }
    throw new Error('Trendyol isteği tamamlanamadı.');
  }
}

function parseCursor(value?: string | null): TrendyolCursor {
  if (!value) return { kind: 'page', page: 0 };
  if (value.startsWith('page:')) {
    const page = Number(value.slice('page:'.length));
    if (!Number.isSafeInteger(page) || page < 0)
      throw new Error('Geçersiz Trendyol sayfa cursor değeri.');
    return { kind: 'page', page };
  }
  if (value.startsWith('token:')) {
    const token = value.slice('token:'.length);
    if (!token || token.length > 4096)
      throw new Error('Geçersiz Trendyol nextPageToken değeri.');
    return { kind: 'token', token };
  }
  throw new Error('Geçersiz Trendyol cursor değeri.');
}

function nextTrendyolCursor(
  cursor: TrendyolCursor,
  responsePage: number,
  nextPageToken?: string | null,
) {
  const token = nextPageToken?.trim();
  if (cursor.kind === 'token') {
    if (!token)
      throw new Error('Trendyol devam sayfası için nextPageToken döndürmedi.');
    return `token:${token}`;
  }
  const nextPage = responsePage + 1;
  if (nextPage * PAGE_SIZE < MAX_PAGE_OFFSET) return `page:${nextPage}`;
  if (!token)
    throw new Error(
      'Trendyol 10.000 üzeri katalog için nextPageToken döndürmedi.',
    );
  return `token:${token}`;
}

function identifier(value: unknown) {
  const result = identifierOrEmpty(value);
  if (!result) throw new Error('Trendyol ürün veya varyant kimliği eksik.');
  return result.slice(0, 160);
}

function identifierOrEmpty(value: unknown) {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value).trim()
    : '';
}

function requiredText(value: unknown, message: string, limit: number) {
  const result = cleanText(value, limit);
  if (!result) throw new Error(message);
  return result;
}

function cleanText(value: unknown, limit: number) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

function cleanDescription(value: string) {
  return value
    .replace(/<[^>]*>/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 5000);
}

function requiredHttpsUrl(value: unknown, message: string) {
  if (typeof value !== 'string') throw new Error(message);
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') throw new Error(message);
    return url.toString();
  } catch {
    throw new Error(message);
  }
}

function resolveHttpsUrl(value: string, base: string) {
  try {
    const url = new URL(value, base);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function firstFiniteNumber(...values: unknown[]) {
  for (const value of values)
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  return null;
}

function addTimestamp(target: number[], value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0)
    target.push(value);
}

function retryAfterMilliseconds(value: string | null, now: number) {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds))
    return Math.min(30_000, Math.max(0, seconds * 1000));
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return undefined;
  return Math.min(30_000, Math.max(0, date - now));
}

async function collectHttpDiagnostics(
  response: Response,
  credentials: TrendyolCredentials,
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
  credentials: TrendyolCredentials,
) {
  let sanitized = value;
  const basicCredential = Buffer.from(
    `${credentials.apiKey}:${credentials.apiSecret}`,
  ).toString('base64');
  const sensitiveValues = [
    credentials.apiKey,
    credentials.apiSecret,
    encodeURIComponent(credentials.apiKey),
    encodeURIComponent(credentials.apiSecret),
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
