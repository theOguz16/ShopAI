import {
  MemoryCatalogRepository,
  type RedirectClaims,
  type RedirectRepository,
  RedirectService,
  RedirectTokens,
  SearchProducts,
  demoRecords,
} from '@shopai/commerce';
import type { AttributionContext } from '@shopai/contracts';
import { WEB_ATTRIBUTION } from '@shopai/contracts';
import {
  DemoQueryParser,
  ModelQueryParser,
  OpenAiResponsesProvider,
} from '@shopai/ai';
import {
  createDatabase,
  PostgresCatalogRepository,
  PostgresRedirectRepository,
  PostgresSearchEventRepository,
} from '@shopai/db';
import type { ApiEnv } from './env.js';
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
              active:
                record.published && record.offerActive && record.merchantActive,
            },
          ]),
        ),
      );
  const search = new SearchProducts(repository, parser, env.CATALOG_MODE);
  const searchEventRepository = database
    ? new PostgresSearchEventRepository(database.db)
    : undefined;
  const executeSearch = async (
    input: unknown,
    context: { merchantIds?: string[] } = {},
    attribution: AttributionContext = WEB_ATTRIBUTION,
  ) => {
    const requestInput =
      input && typeof input === 'object'
        ? (input as { cursor?: unknown; merchantIds?: unknown })
        : {};
    const requestKind = requestInput.cursor ? 'pagination' : 'initial';
    const explicitMerchantIds = context.merchantIds?.length
      ? context.merchantIds
      : Array.isArray(requestInput.merchantIds)
        ? requestInput.merchantIds.filter(
            (value): value is string => typeof value === 'string',
          )
        : [];
    try {
      const result = await search.execute(input, context);
      const merchantIds = explicitMerchantIds.length
        ? explicitMerchantIds
        : [...new Set(result.items.map((item) => item.merchantId))];
      if (searchEventRepository && merchantIds.length) {
        await searchEventRepository.record(
          merchantIds.map((merchantId) => ({
            merchantId,
            searchId: result.searchId,
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
            ...attribution,
            requestKind,
            outcome: 'error',
          })),
        );
      }
      throw error;
    }
  };
  return {
    search,
    executeSearch,
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
    claims: RedirectClaims;
    merchantId: string;
    classification: 'human' | 'bot';
  }> = [];

  constructor(
    private readonly targets: Map<
      string,
      { url: string; merchantId: string; active: boolean }
    >,
  ) {}

  async resolvePublishedOffer(offerId: string) {
    const target = this.targets.get(offerId);
    return target?.active ? target : null;
  }

  async recordClick(input: (typeof this.clicks)[number]) {
    this.clicks.push(input);
  }
}
