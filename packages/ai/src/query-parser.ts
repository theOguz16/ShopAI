import {
  type ModelSearchIntent,
  type ParserTelemetry,
  type SearchRequest,
  modelSearchIntentSchema,
} from '@shopai/contracts';
import {
  normalizeCategory,
  normalizeColor,
  normalizeSize,
  type QueryParser,
} from '@shopai/commerce';

export const SEARCH_INTENT_PROMPT_VERSION = 'search-intent-v2';

const intentJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'category',
    'colors',
    'excludedColors',
    'sizes',
    'excludedSizes',
    'excludedCategories',
    'minPriceMinor',
    'maxPriceMinor',
    'inStockOnly',
    'ambiguous',
    'unsupported',
  ],
  properties: {
    category: { type: ['string', 'null'] },
    colors: { type: 'array', items: { type: 'string' }, maxItems: 20 },
    excludedColors: { type: 'array', items: { type: 'string' }, maxItems: 20 },
    sizes: { type: 'array', items: { type: 'string' }, maxItems: 20 },
    excludedSizes: { type: 'array', items: { type: 'string' }, maxItems: 20 },
    excludedCategories: {
      type: 'array',
      items: { type: 'string' },
      maxItems: 20,
    },
    minPriceMinor: { type: ['integer', 'null'], minimum: 0 },
    maxPriceMinor: { type: ['integer', 'null'], minimum: 0 },
    inStockOnly: { type: ['boolean', 'null'] },
    ambiguous: { type: 'boolean' },
    unsupported: { type: 'array', items: { type: 'string' }, maxItems: 10 },
  },
} as const;

const instructions = `Türkçe alışveriş sorgusunu yalnız açıkça belirtilen katalog filtrelerine dönüştür.
Alt fiyatı minPriceMinor, üst fiyatı maxPriceMinor alanına kuruş cinsinden yaz. Renk olumsuzsa colors yerine excludedColors kullan.
Kullanıcının söylemediği fiyat, stok, marka, kategori veya ürün özelliğini ASLA üretme.
Öznel ya da desteklenmeyen istekleri unsupported listesine yaz ve ambiguous=true yap.
Çıktıda yalnız verilen JSON şemasını kullan.`;

export interface ModelProviderResult {
  intent: unknown;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
}

export interface ModelProvider {
  readonly name: string;
  readonly model: string;
  generate(args: {
    query: string;
    signal: AbortSignal;
    maxOutputTokens: number;
  }): Promise<ModelProviderResult>;
}

type OpenAiResponse = {
  model?: string;
  output_text?: string;
  output?: Array<{
    content?: Array<{ type?: string; text?: string }>;
  }>;
  usage?: { input_tokens?: number; output_tokens?: number };
};

export class OpenAiResponsesProvider implements ModelProvider {
  readonly name = 'openai';
  constructor(
    readonly model: string,
    private readonly apiKey: string,
  ) {}

  async generate({
    query,
    signal,
    maxOutputTokens,
  }: {
    query: string;
    signal: AbortSignal;
    maxOutputTokens: number;
  }): Promise<ModelProviderResult> {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      signal,
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        store: false,
        max_output_tokens: maxOutputTokens,
        instructions,
        input: query,
        text: {
          format: {
            type: 'json_schema',
            name: 'shopai_search_intent',
            strict: true,
            schema: intentJsonSchema,
          },
        },
      }),
    });
    if (!response.ok)
      throw new Error(`Model sağlayıcısı HTTP ${response.status} döndürdü.`);
    const body = (await response.json()) as OpenAiResponse;
    const outputText =
      body.output_text ??
      body.output
        ?.flatMap((item) => item.content ?? [])
        .find((content) => content.type === 'output_text')?.text;
    if (!outputText)
      throw new Error('Model sağlayıcısı yapılandırılmış çıktı vermedi.');
    return {
      intent: JSON.parse(outputText),
      model: body.model ?? this.model,
      usage: {
        inputTokens: body.usage?.input_tokens ?? 0,
        outputTokens: body.usage?.output_tokens ?? 0,
      },
    };
  }
}

export interface ModelQueryParserOptions {
  timeoutMs: number;
  maxOutputTokens: number;
  maxCostUsd: number;
  inputUsdPerMillionTokens: number;
  outputUsdPerMillionTokens: number;
}

function estimateCost(
  inputTokens: number,
  outputTokens: number,
  options: ModelQueryParserOptions,
) {
  return (
    (inputTokens * options.inputUsdPerMillionTokens +
      outputTokens * options.outputUsdPerMillionTokens) /
    1_000_000
  );
}

function intentFilters(intent: ModelSearchIntent) {
  const excludedColors = [
    ...new Set(intent.excludedColors.map(normalizeColor)),
  ];
  const excludedSizes = [...new Set(intent.excludedSizes.map(normalizeSize))];
  const excludedCategories = [
    ...new Set(intent.excludedCategories.map(normalizeCategory)),
  ];
  const filters: Partial<SearchRequest['filters']> = {
    colors: [...new Set(intent.colors.map(normalizeColor))].filter(
      (color) => !excludedColors.includes(color),
    ),
    excludedColors,
    sizes: [...new Set(intent.sizes.map(normalizeSize))].filter(
      (size) => !excludedSizes.includes(size),
    ),
    excludedSizes,
    excludedCategories,
  };
  if (
    intent.category &&
    !excludedCategories.includes(normalizeCategory(intent.category))
  )
    filters.category = normalizeCategory(intent.category);
  if (intent.maxPriceMinor !== null)
    filters.maxPriceMinor = intent.maxPriceMinor;
  if (intent.minPriceMinor !== null)
    filters.minPriceMinor = intent.minPriceMinor;
  if (intent.inStockOnly !== null) filters.inStockOnly = intent.inStockOnly;
  return filters;
}

export class ModelQueryParser implements QueryParser {
  constructor(
    private readonly provider: ModelProvider,
    private readonly fallback: QueryParser,
    private readonly options: ModelQueryParserOptions,
  ) {}

  async parse(query: string) {
    const startedAt = performance.now();
    const estimatedInputTokens = Math.ceil(
      (instructions.length + query.length) / 4,
    );
    const preflightCost = estimateCost(
      estimatedInputTokens,
      this.options.maxOutputTokens,
      this.options,
    );
    if (preflightCost > this.options.maxCostUsd)
      return this.fallbackResult(
        query,
        startedAt,
        'cost_preflight_limit',
        preflightCost,
      );
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.options.timeoutMs,
    );
    try {
      const result = await this.provider.generate({
        query,
        signal: controller.signal,
        maxOutputTokens: this.options.maxOutputTokens,
      });
      const intent = modelSearchIntentSchema.parse(result.intent);
      const estimatedCostUsd = estimateCost(
        result.usage.inputTokens,
        result.usage.outputTokens,
        this.options,
      );
      if (estimatedCostUsd > this.options.maxCostUsd)
        return this.fallbackResult(
          query,
          startedAt,
          'actual_cost_limit',
          estimatedCostUsd,
          result.usage,
        );
      const warnings = intent.unsupported.map(
        (feature) => `Desteklenmeyen veya doğrulanamayan istek: ${feature}`,
      );
      if (intent.ambiguous)
        warnings.push(
          'İstek belirsiz; yalnız açık ve doğrulanabilir filtreler uygulandı.',
        );
      return {
        filters: intentFilters(intent),
        warnings,
        telemetry: {
          provider: this.provider.name,
          model: result.model,
          promptVersion: SEARCH_INTENT_PROMPT_VERSION,
          latencyMs: performance.now() - startedAt,
          estimatedCostUsd,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          fallback: false,
        } satisfies ParserTelemetry,
      };
    } catch (error) {
      return this.fallbackResult(
        query,
        startedAt,
        controller.signal.aborted ? 'timeout' : 'provider_or_schema_error',
        0,
        undefined,
        error,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private async fallbackResult(
    query: string,
    startedAt: number,
    reason: string,
    estimatedCostUsd: number,
    usage = { inputTokens: 0, outputTokens: 0 },
    _error?: unknown,
  ) {
    const result = await this.fallback.parse(query);
    return {
      ...result,
      warnings: [
        ...result.warnings,
        `Model yorumlama kullanılamadı (${reason}); klasik arama uygulandı.`,
      ],
      telemetry: {
        provider: this.provider.name,
        model: this.provider.model,
        promptVersion: SEARCH_INTENT_PROMPT_VERSION,
        latencyMs: performance.now() - startedAt,
        estimatedCostUsd,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        fallback: true,
        fallbackReason: reason,
      } satisfies ParserTelemetry,
    };
  }
}
