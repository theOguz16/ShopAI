import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  DemoQueryParser,
  ModelQueryParser,
  SEARCH_INTENT_PROMPT_VERSION,
  type ModelProvider,
} from '../../packages/ai/src/index.js';
import {
  MemoryCatalogRepository,
  SearchProducts,
  demoRecords,
  normalizeCategory,
  normalizeColor,
  normalizeSize,
} from '../../packages/commerce/src/index.js';

type Evaluation = {
  id: string;
  class?: string;
  query: string;
  expected: Record<string, unknown>;
  warning?: string;
};

type UserTask = {
  id: string;
  class: string;
  query: string;
  expectedOfferIds: string[];
};

const evaluations = JSON.parse(
  readFileSync(new URL('./search-intents.json', import.meta.url), 'utf8'),
) as Evaluation[];
const holdoutEvaluations = JSON.parse(
  readFileSync(
    new URL('./search-intents-holdout.json', import.meta.url),
    'utf8',
  ),
) as Evaluation[];
const userTasks = JSON.parse(
  readFileSync(new URL('./search-user-tasks.json', import.meta.url), 'utf8'),
) as UserTask[];

const completeIntent = {
  category: null,
  colors: [],
  excludedColors: [],
  sizes: [],
  excludedSizes: [],
  excludedCategories: [],
  minPriceMinor: null,
  maxPriceMinor: null,
  inStockOnly: null,
  ambiguous: false,
  unsupported: [],
};

const options = {
  timeoutMs: 25,
  maxOutputTokens: 200,
  maxCostUsd: 0.01,
  inputUsdPerMillionTokens: 1,
  outputUsdPerMillionTokens: 2,
};

describe('Turkish search intent quality', () => {
  it('reports a reproducible baseline with zero labeled hard violations', async () => {
    expect(evaluations.length).toBeGreaterThanOrEqual(50);
    const parser = new DemoQueryParser();
    let hardViolations = 0;
    const violationIds: string[] = [];
    let totalLatencyMs = 0;
    for (const evaluation of evaluations) {
      const result = await parser.parse(evaluation.query);
      totalLatencyMs += result.telemetry.latencyMs;
      for (const [key, expected] of Object.entries(evaluation.expected)) {
        if (
          JSON.stringify(result.filters[key as keyof typeof result.filters]) !==
          JSON.stringify(expected)
        ) {
          hardViolations += 1;
          violationIds.push(`${evaluation.id}:${key}`);
        }
      }
      if (evaluation.warning)
        expect(result.warnings.join(' '), evaluation.id).toContain(
          evaluation.warning,
        );
    }
    const report = {
      promptVersion: SEARCH_INTENT_PROMPT_VERSION,
      provider: 'rules',
      model: 'deterministic-v2',
      queryCount: evaluations.length,
      hardViolations,
      violationIds,
      averageLatencyMs: totalLatencyMs / evaluations.length,
      estimatedCostUsd: 0,
    };
    console.info('SEARCH_QUALITY_REPORT', JSON.stringify(report));
    expect(report.hardViolations).toBe(0);
  });

  it('keeps the locked holdout at zero hard-filter violations', async () => {
    const parser = new DemoQueryParser();
    const violations: string[] = [];
    for (const evaluation of holdoutEvaluations) {
      const result = await parser.parse(evaluation.query);
      for (const [key, expected] of Object.entries(evaluation.expected))
        if (
          JSON.stringify(result.filters[key as keyof typeof result.filters]) !==
          JSON.stringify(expected)
        )
          violations.push(`${evaluation.id}:${key}`);
    }
    console.info(
      'SEARCH_HOLDOUT_REPORT',
      JSON.stringify({
        queryCount: holdoutEvaluations.length,
        hardViolations: violations.length,
        violationIds: violations,
      }),
    );
    expect(violations).toEqual([]);
  });

  it('measures result relevance separately from hard-filter safety', async () => {
    const search = new SearchProducts(
      new MemoryCatalogRepository(demoRecords),
      new DemoQueryParser(),
      'demo',
    );
    const failedTasks: string[] = [];
    const hardFilterViolations: string[] = [];
    for (const task of userTasks) {
      const result = await search.execute({
        query: task.query,
        filters: { inStockOnly: true },
      });
      const actualIds = result.items.map((item) => item.offerId);
      const taskPassed =
        task.expectedOfferIds.length === 0
          ? actualIds.length === 0
          : task.expectedOfferIds.every((id) => actualIds.includes(id));
      if (!taskPassed) failedTasks.push(task.id);
      for (const item of result.items) {
        const filters = result.appliedFilters;
        if (
          (filters.category &&
            normalizeCategory(item.category) !==
              normalizeCategory(filters.category)) ||
          (filters.colors.length > 0 &&
            !filters.colors.some(
              (color) => normalizeColor(color) === normalizeColor(item.color),
            )) ||
          filters.excludedColors.some(
            (color) => normalizeColor(color) === normalizeColor(item.color),
          ) ||
          (filters.sizes.length > 0 &&
            !filters.sizes.some(
              (size) => normalizeSize(size) === normalizeSize(item.size),
            )) ||
          (filters.minPriceMinor !== undefined &&
            item.priceMinor < filters.minPriceMinor) ||
          (filters.maxPriceMinor !== undefined &&
            item.priceMinor > filters.maxPriceMinor) ||
          (filters.inStockOnly && item.stockStatus !== 'in_stock')
        )
          hardFilterViolations.push(`${task.id}:${item.offerId}`);
      }
    }
    console.info(
      'SEARCH_TASK_REPORT',
      JSON.stringify({
        taskCount: userTasks.length,
        successfulTasks: userTasks.length - failedTasks.length,
        successRate: (userTasks.length - failedTasks.length) / userTasks.length,
        failedTasks,
        hardFilterViolations: hardFilterViolations.length,
      }),
    );
    expect(hardFilterViolations).toEqual([]);
    expect(failedTasks).toEqual([]);
  });
});

describe('bounded model parser', () => {
  it('does not let inferred filters replace explicit UI selections', async () => {
    const provider: ModelProvider = {
      name: 'fake',
      model: 'fake-v1',
      generate: vi.fn(async () => ({
        intent: { ...completeIntent, colors: ['black'], sizes: ['L'] },
        model: 'fake-v1',
        usage: { inputTokens: 10, outputTokens: 10 },
      })),
    };
    const search = new SearchProducts(
      new MemoryCatalogRepository(demoRecords),
      new ModelQueryParser(provider, new DemoQueryParser(), options),
      'demo',
    );
    const result = await search.execute({
      query: 'bir ürün',
      filters: { colors: ['white'], sizes: ['M'] },
    });
    expect(result.appliedFilters.colors).toEqual(['white']);
    expect(result.appliedFilters.sizes).toEqual(['M']);
  });

  it('gives an inferred exclusion priority over a contradictory inference', async () => {
    const provider: ModelProvider = {
      name: 'fake',
      model: 'contradictory-v1',
      generate: vi.fn(async () => ({
        intent: {
          ...completeIntent,
          colors: ['black'],
          excludedColors: ['siyah'],
        },
        model: 'contradictory-v1',
        usage: { inputTokens: 10, outputTokens: 10 },
      })),
    };
    const result = await new ModelQueryParser(
      provider,
      new DemoQueryParser(),
      options,
    ).parse('siyah olmayan tişört');
    expect(result.filters.colors).toEqual([]);
    expect(result.filters.excludedColors).toEqual(['black']);
  });

  it('falls back to classic parsing when the provider fails', async () => {
    const provider: ModelProvider = {
      name: 'fake',
      model: 'broken-v1',
      generate: vi.fn(async () => {
        throw new Error('offline');
      }),
    };
    const result = await new ModelQueryParser(
      provider,
      new DemoQueryParser(),
      options,
    ).parse('siyah M beden tişört');
    expect(result.filters).toMatchObject({
      category: 'tshirt',
      colors: ['black'],
      sizes: ['M'],
    });
    expect(result.telemetry).toMatchObject({
      fallback: true,
      fallbackReason: 'provider_or_schema_error',
    });
  });

  it('enforces the preflight cost ceiling without calling the model', async () => {
    const generate = vi.fn();
    const provider: ModelProvider = {
      name: 'fake',
      model: 'expensive-v1',
      generate,
    };
    const result = await new ModelQueryParser(provider, new DemoQueryParser(), {
      ...options,
      maxCostUsd: 0.0000001,
    }).parse('beyaz tişört');
    expect(generate).not.toHaveBeenCalled();
    expect(result.telemetry.fallbackReason).toBe('cost_preflight_limit');
  });

  it('rejects invalid structured output and reports unsupported intent', async () => {
    const invalidProvider: ModelProvider = {
      name: 'fake',
      model: 'invalid-v1',
      generate: vi.fn(async () => ({
        intent: { colors: ['black'] },
        model: 'invalid-v1',
        usage: { inputTokens: 10, outputTokens: 10 },
      })),
    };
    const invalid = await new ModelQueryParser(
      invalidProvider,
      new DemoQueryParser(),
      options,
    ).parse('siyah tişört');
    expect(invalid.telemetry.fallbackReason).toBe('provider_or_schema_error');

    const unsupportedProvider: ModelProvider = {
      name: 'fake',
      model: 'valid-v1',
      generate: vi.fn(async () => ({
        intent: {
          ...completeIntent,
          ambiguous: true,
          unsupported: ['çok havalı'],
        },
        model: 'valid-v1',
        usage: { inputTokens: 10, outputTokens: 10 },
      })),
    };
    const unsupported = await new ModelQueryParser(
      unsupportedProvider,
      new DemoQueryParser(),
      options,
    ).parse('çok havalı bir ürün');
    expect(unsupported.warnings.join(' ')).toMatch(
      /Desteklenmeyen.*çok havalı.*belirsiz/,
    );
  });

  it('times out and returns the classic result', async () => {
    const provider: ModelProvider = {
      name: 'fake',
      model: 'slow-v1',
      generate: ({ signal }) =>
        new Promise((_, reject) => {
          signal.addEventListener('abort', () => reject(new Error('abort')));
        }),
    };
    const result = await new ModelQueryParser(provider, new DemoQueryParser(), {
      ...options,
      timeoutMs: 5,
    }).parse('stokta tişört');
    expect(result.filters.inStockOnly).toBe(true);
    expect(result.telemetry.fallbackReason).toBe('timeout');
  });
});
