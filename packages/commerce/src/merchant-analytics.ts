import type { Surface } from '@shopai/contracts';

export type MerchantAnalyticsAggregate = {
  aiSearches: number;
  productViews: number;
  checkoutClicks: number;
  orders: number;
  attributedGmvMinor: number;
  netRevenueMinor: number;
  measured: boolean;
  checkoutClicksBySurface: Partial<Record<Surface, number>>;
};

export type SurfaceBreakdown = {
  counts: {
    chatgpt: number;
    web: number;
    other: number;
  };
  shares: {
    chatgpt: number;
    web: number;
    other: number;
  };
};

const ratio = (numerator: number, denominator: number) =>
  denominator > 0 ? numerator / denominator : null;

const countFor = (counts: Partial<Record<Surface, number>>, surface: Surface) =>
  counts[surface] ?? 0;

export function buildSurfaceBreakdown(
  counts: Partial<Record<Surface, number>>,
): SurfaceBreakdown {
  const chatgpt = countFor(counts, 'chatgpt');
  const web = countFor(counts, 'web');
  const other = countFor(counts, 'gemini') + countFor(counts, 'brand_widget');
  const total = chatgpt + web + other;

  return {
    counts: { chatgpt, web, other },
    shares: {
      chatgpt: total > 0 ? chatgpt / total : 0,
      web: total > 0 ? web / total : 0,
      other: total > 0 ? other / total : 0,
    },
  };
}

export function buildMerchantAnalyticsMetrics(
  aggregate: MerchantAnalyticsAggregate,
) {
  const surfaceBreakdown = buildSurfaceBreakdown(
    aggregate.checkoutClicksBySurface,
  );
  const orders = aggregate.measured ? aggregate.orders : null;
  const attributedGmvMinor = aggregate.measured
    ? aggregate.attributedGmvMinor
    : null;
  const netRevenueMinor = aggregate.measured ? aggregate.netRevenueMinor : null;

  return {
    aiSearches: aggregate.aiSearches,
    productViews: aggregate.productViews,
    checkoutClicks: aggregate.checkoutClicks,
    orders,
    attributedGmvMinor,
    netRevenueMinor,
    searchToCheckoutRate: ratio(aggregate.checkoutClicks, aggregate.aiSearches),
    checkoutToOrderRate:
      aggregate.measured && aggregate.checkoutClicks > 0
        ? aggregate.orders / aggregate.checkoutClicks
        : null,
    surfaceBreakdown,
  };
}
