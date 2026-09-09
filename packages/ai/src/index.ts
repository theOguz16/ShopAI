import {
  CATEGORY_ALIASES,
  COLOR_ALIASES,
  normalizeCategory,
  normalizeColor,
  normalizeTurkish,
  type QueryParser,
  SIZE_ALIASES,
} from '@shopai/commerce';
import type { SearchRequest } from '@shopai/contracts';

/** Offline bootstrap parser. This is deliberately not an LLM or semantic search. */
export class DemoQueryParser implements QueryParser {
  async parse(query: string) {
    const startedAt = performance.now();
    const original = query.toLocaleLowerCase('tr-TR');
    const text = normalizeTurkish(query);
    const filters: Partial<SearchRequest['filters']> = {};
    const warnings: string[] = [];
    const words = text.split(' ');
    const category = words
      .map((word) => [word, normalizeCategory(word)] as const)
      .find(([, normalized]) =>
        Object.values(CATEGORY_ALIASES).includes(normalized),
      );
    if (category?.[1]) filters.category = category[1];
    const negatedColors = [
      ...new Set(
        Object.entries(COLOR_ALIASES)
          .filter(([alias]) => {
            const color = normalizeTurkish(alias);
            return [
              `${color} olmayan`,
              `${color} olmasin`,
              `${color} degil`,
              `${color} haric`,
              `${color} istemiyorum`,
            ].some((phrase) => text.includes(phrase));
          })
          .map(([, value]) => value),
      ),
    ];
    if (negatedColors.length) {
      filters.excludedColors = negatedColors;
      filters.colors = [];
    }
    const matched = [
      ...new Set(
        Object.entries(COLOR_ALIASES)
          .filter(([, value]) =>
            words.some((word) => normalizeColor(word) === value),
          )
          .map(([, value]) => value),
      ),
    ].filter((color) => !negatedColors.includes(color));
    if (matched.length) filters.colors = matched;
    const size = text.match(
      /(?:^|\s)(?:beden(?:im)?\s*)?(xs|s|small|kucuk|m|medium|orta|l|large|buyuk|xl|xxl)(?:[-\s]*beden)?(?:\s|$)/u,
    );
    if (size?.[1]) filters.sizes = [SIZE_ALIASES[size[1]] ?? size[1]];
    const price =
      original.match(
        /(\d+(?:[.]\d{3})*(?:,\d{1,2})?)\s*(?:tl|₺|lira(?:yı)?)\s*(?:altında|altı|geçmesin|üst sınır|dan az|den az)/iu,
      ) ??
      original.match(
        /(?:en fazla|bütçem|bütçe)\s*(\d+(?:[.]\d{3})*(?:,\d{1,2})?)\s*(?:tl|₺|lira)?/iu,
      );
    if (price?.[1])
      filters.maxPriceMinor = Math.round(
        Number(price[1].replaceAll('.', '').replace(',', '.')) * 100,
      );
    const range = original.match(
      /(\d+(?:[.]\d{3})*(?:,\d{1,2})?)\s*(?:tl|₺|lira)?\s*(?:ile|-|–)\s*(\d+(?:[.]\d{3})*(?:,\d{1,2})?)\s*(?:tl|₺|lira)?\s*(?:arası|arasında)?/iu,
    );
    if (range?.[1] && range[2]) {
      const toMinor = (value: string) =>
        Math.round(Number(value.replaceAll('.', '').replace(',', '.')) * 100);
      filters.minPriceMinor = toMinor(range[1]);
      filters.maxPriceMinor = toMinor(range[2]);
    }
    if (/(stok önemli değil|stok fark etmez)/iu.test(original))
      filters.inStockOnly = false;
    else if (/(stokta|stoklu|hemen teslim)/iu.test(original))
      filters.inStockOnly = true;
    const hasNegation = /(olmasin|olmayan|degil|haric|istemiyorum)/u.test(text);
    if (hasNegation && !negatedColors.length)
      warnings.push(
        'Renk dışındaki olumsuz özellikler henüz desteklenmiyor; bu ifade metin aramasında korunur.',
      );
    if (/(şık|güzel|uygun|kaliteli|rahat)/iu.test(original))
      warnings.push(
        'Öznel özellikler güvenilir bir katalog alanına bağlı değil; fiyat veya stok uydurulmadı.',
      );
    return {
      filters,
      warnings,
      telemetry: {
        provider: 'rules',
        model: 'deterministic-v2',
        promptVersion: 'search-intent-v2',
        latencyMs: performance.now() - startedAt,
        estimatedCostUsd: 0,
        inputTokens: 0,
        outputTokens: 0,
        fallback: false,
      },
    };
  }
}

export * from './query-parser.js';
