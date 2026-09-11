import {
  MemoryCatalogRepository,
  type RedirectClaims,
  type RedirectRepository,
  RedirectService,
  RedirectTokens,
  SearchProducts,
  demoRecords,
} from '@shopai/commerce';
import {
  DiscoverySessions,
  type DiscoverySessionRepository,
} from '@shopai/commerce/discovery';
import {
  MemoryProductDetailRepository,
  ProductDetails,
} from '@shopai/commerce/product-detail';
import { ProductViews } from '@shopai/commerce/product-views';
import {
  parseSearchProductsRequest,
  toInternalSearchInput,
  toSearchProductsResponse,
} from '@shopai/commerce/public-search';
import type {
  AttributionContext,
  DiscoverySession,
  Surface,
} from '@shopai/contracts';
import { WEB_ATTRIBUTION } from '@shopai/contracts';
import {
  DemoQueryParser,
  ModelQueryParser,
  OpenAiResponsesProvider,
} from '@shopai/ai';
import {
  createDatabase,
  PostgresCatalogRepository,
  PostgresDiscoverySessionRepository,
  PostgresProductDetailRepository,
  PostgresProductViewEventRepository,
  PostgresRedirectRepository,
  PostgresSearchEventRepository,
} from '@shopai/db';
import type { ApiEnv } from './env.js';

const restDiscoverySurfaces = new Set<Surface>(['web', 'brand_widget']);

export function createServices(env: ApiEnv) {
  const database =
    env.CATALOG_MODE === 'postgres'
      ? createDatabase(env.DATABASE_URL)
      : undefined;
  const repository = database
    ? new PostgresCatalogRepository(database.db)
    : new MemoryCatalogRepository(demoRecords);
  const rulesParser = new DemoQueryParser();
  const parser =
    env.AI_PROVIDER === 'openai'
      ? new ModelQueryParser(
          new OpenAiResponsesProvider(env.AI_MODEL, env.OPENAI_API_KEY ?? ''),
          rulesParser,
          {
            timeoutMs: env.AI_TIMEOUT_MS,
            maxOutputTokens: env.AI_MAX_OUTPUT_TOKENS,
            maxCostUsd: env.AI_MAX_COST_USD,
            inputUsdPerMillionTokens: env.AI_INPUT_USD_PER_MILLION ?? 0,
            outputUsdPerMillionTokens: env.AI_OUTPUT_USD_PER_MILLION ?? 0,
          },
        )
      : rulesParser;
  const redirectRepository: RedirectRepository = database
    ? new PostgresRedirectRepository(database.db)
    : new MemoryRedirectRepository(
        new Map(
          demoRecords.map((record) => [
            record.offerId,
            {
              url: record.checkoutUrl,
              merchantId: record.merchantId,
              productId: record.productId,
              active:
                record.published && record.offerActive && record.merchantActive,
            },
          ]),
        ),
      );
  const discoverySessionRepository: DiscoverySessionRepository = database
    ? new PostgresDiscoverySessionRepository(database.db)
    : new MemoryDiscoverySessionRepository(demoRecords);
  const discoverySessions = new DiscoverySessions(discoverySessionRepository);
  const search = new SearchProducts(repository, parser, env.CATALOG_MODE);
  const productDetailRepository = database
    ? new PostgresProductDetailRepository(database.db)
    : new MemoryProductDetailRepository(demoRecords);
  const productDetails = new ProductDetails(productDetailRepository, search);
  const searchEventRepository = database
    ? new PostgresSearchEventRepository(database.db)
    : undefined;
  const productViews = new ProductViews(
    database ? new PostgresProductViewEventRepository(database.db) : undefined,
  );

  const resolveRestAttribution = async (
    input: unknown,
  ): Promise<AttributionContext> => {
    const requestInput =
      input && typeof input === 'object'
        ? (input as { discoverySessionId?: unknown })
        : {};
    if (typeof requestInput.discoverySessionId !== 'string')
      return WEB_ATTRIBUTION;
    const session = await discoverySessions.require(
      requestInput.discoverySessionId,
    );
    if (
      session.transport !== 'rest' ||
      !restDiscoverySurfaces.has(session.surface)
    )
      throw Object.assign(
        new Error('Discovery session REST attribution için geçersiz.'),
        {
          statusCode: 400,
          code: 'DISCOVERY_SESSION_ATTRIBUTION_MISMATCH',
        },
      );
    return { transport: 'rest', surface: session.surface };
  };

  const executeSearch = async (
    input: unknown,
    context: { merchantIds?: string[] } = {},
    attribution: AttributionContext = WEB_ATTRIBUTION,
  ) => {
    const requestInput =
      input && typeof input === 'object'
        ? (input as {
            cursor?: unknown;
            merchantIds?: unknown;
            discoverySessionId?: unknown;
          })
        : {};
    const requestKind = requestInput.cursor ? 'pagination' : 'initial';
    let scopedContext = context;
    let discoverySessionId: string;
    if (typeof requestInput.discoverySessionId === 'string') {
      const session = await discoverySessions.require(
        requestInput.discoverySessionId,
      );
      discoverySessions.assertAttribution(session, attribution);
      scopedContext = discoverySessions.applyMerchantScope(session, context);
      discoverySessionId = session.id;
    } else {
      const session = await discoverySessions.create(
        { surface: attribution.surface },
        { transport: attribution.transport },
      );
      discoverySessionId = session.id;
    }
    const explicitMerchantIds = scopedContext.merchantIds?.length
      ? scopedContext.merchantIds
      : Array.isArray(requestInput.merchantIds)
        ? requestInput.merchantIds.filter(
            (value): value is string => typeof value === 'string',
          )
        : [];
    try {
      const result = await search.execute(input, scopedContext);
      const merchantIds = explicitMerchantIds.length
        ? explicitMerchantIds
        : [...new Set(result.items.map((item) => item.merchantId))];
      if (searchEventRepository && merchantIds.length) {
        await searchEventRepository.record(
          merchantIds.map((merchantId) => ({
            merchantId,
            searchId: result.searchId,
            discoverySessionId,
            ...attribution,
            requestKind,
            outcome: result.items.length ? 'results' : 'empty',
          })),
        );
      }
      return result;
    } catch (error) {
      if (searchEventRepository && explicitMerchantIds.length) {
        await searchEventRepository.record(
          explicitMerchantIds.map((merchantId) => ({
            merchantId,
            discoverySessionId,
            ...attribution,
            requestKind,
            outcome: 'error',
          })),
        );
      }
      throw error;
    }
  };
  const executePublicSearch = async (
    input: unknown,
    context: { merchantIds?: string[] } = {},
    attribution: AttributionContext = WEB_ATTRIBUTION,
  ) => {
    const request = parseSearchProductsRequest(input);
    const result = await executeSearch(
      toInternalSearchInput(request),
      context,
      attribution,
    );
    return toSearchProductsResponse(result);
  };
  const executeProductDetail = async (
    input: unknown,
    context: { merchantIds?: string[] } = {},
    attribution: AttributionContext = WEB_ATTRIBUTION,
  ) => {
    const requestInput =
      input && typeof input === 'object'
        ? (input as { discoverySessionId?: unknown })
        : {};
    let scopedContext = context;
    let discoverySessionId: string | undefined;
    if (typeof requestInput.discoverySessionId === 'string') {
      const session = await discoverySessions.require(
        requestInput.discoverySessionId,
      );
      discoverySessions.assertAttribution(session, attribution);
      scopedContext = discoverySessions.applyMerchantScope(session, context);
      discoverySessionId = session.id;
    }
    const result = await productDetails.execute(input, scopedContext);
    await productViews.record({
      merchantId: result.merchant.id,
      productId: result.product.id,
      searchId: result.searchId,
      ...(discoverySessionId ? { discoverySessionId } : {}),
      ...attribution,
    });
    return result;
  };
  return {
    search,
    productDetails,
    executeSearch,
    executePublicSearch,
    executeProductDetail,
    resolveRestAttribution,
    discoverySessions,
    repository,
    redirects: new RedirectService(
      new RedirectTokens(
        env.REDIRECT_SIGNING_SECRET,
        env.REDIRECT_TOKEN_TTL_SECONDS,
      ),
      redirectRepository,
      env.MCP_PUBLIC_ORIGIN,
    ),
    redirectRepository,
    close: async () => {
      await database?.close();
    },
  };
}
export type Services = ReturnType<typeof createServices>;

export class MemoryRedirectRepository implements RedirectRepository {
  readonly clicks: Array<{
    id: string;
    claims: RedirectClaims;
    merchantId: string;
    productId: string;
    classification: 'human' | 'bot';
  }> = [];

  constructor(
    private readonly targets: Map<
      string,
      {
        url: string;
        merchantId: string;
        productId: string;
        active: boolean;
      }
    >,
  ) {}

  async resolvePublishedOffer(offerId: string) {
    const target = this.targets.get(offerId);
    return target?.active ? target : null;
  }

  async recordClick(input: Parameters<RedirectRepository['recordClick']>[0]) {
    const id = crypto.randomUUID();
    this.clicks.push({ id, ...input });
    return id;
  }
}

class MemoryDiscoverySessionRepository implements DiscoverySessionRepository {
  private readonly sessions = new Map<string, DiscoverySession>();
  private readonly merchantIds: Set<string>;

  constructor(records: readonly { merchantId: string }[]) {
    this.merchantIds = new Set(records.map((record) => record.merchantId));
  }

  async resolvePublicMerchant(value: string) {
    return this.merchantIds.has(value) ? { id: value } : null;
  }

  async create(input: Parameters<DiscoverySessionRepository['create']>[0]) {
    const now = new Date().toISOString();
    const session: DiscoverySession = {
      id: crypto.randomUUID(),
      ...input,
      createdAt: now,
      updatedAt: now,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  async findById(id: string) {
    return this.sessions.get(id) ?? null;
  }
}
