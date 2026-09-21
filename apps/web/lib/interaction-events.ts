import type { SearchResponse } from '@shopai/contracts';

const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';

export async function recordProductImpressions(
  result: Pick<SearchResponse, 'discoverySessionId' | 'items'>,
) {
  if (!result.discoverySessionId || !result.items.length) return;
  const seen = new Set<string>();
  const events = result.items.flatMap((item) => {
    const key = `${item.merchantId}:${item.productId}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [
      {
        eventKey: crypto.randomUUID(),
        type: 'product_impression' as const,
        merchantId: item.merchantId,
        productId: item.productId,
      },
    ];
  });
  await fetch(`${api}/v1/interaction-events`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      discoverySessionId: result.discoverySessionId,
      events,
    }),
  });
}

export async function recordSelectionEvents(
  result: Pick<SearchResponse, 'discoverySessionId' | 'items'>,
  input: {
    category?: string | null;
    filterKinds?: Array<'size' | 'color' | 'price' | 'stock' | 'attribute'>;
  },
) {
  if (!result.discoverySessionId) return;
  const merchantIds = [...new Set(result.items.map((item) => item.merchantId))];
  const events = merchantIds.flatMap((merchantId) => [
    ...(input.category
      ? [
          {
            eventKey: crypto.randomUUID(),
            type: 'category_selected' as const,
            merchantId,
            category: input.category,
          },
        ]
      : []),
    ...(input.filterKinds ?? []).map((filterKind) => ({
      eventKey: crypto.randomUUID(),
      type: 'filter_applied' as const,
      merchantId,
      filterKind,
    })),
  ]);
  if (!events.length) return;
  await fetch(`${api}/v1/interaction-events`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      discoverySessionId: result.discoverySessionId,
      events,
    }),
  });
}
