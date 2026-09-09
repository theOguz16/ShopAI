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
  DemoQueryParser,
  ModelQueryParser,
  OpenAiResponsesProvider,
} from '@shopai/ai';
import {
  createDatabase,
  PostgresCatalogRepository,
  PostgresRedirectRepository,
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
  return {
    search: new SearchProducts(repository, parser, env.CATALOG_MODE),
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
