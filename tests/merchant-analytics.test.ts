import { describe, expect, it } from 'vitest';
import { buildMerchantAnalyticsMetrics } from '../packages/commerce/src/merchant-analytics.js';

describe('merchant analytics metrics', () => {
  it('calculates the merchant funnel and groups non-web/chatgpt surfaces as other', () => {
    const metrics = buildMerchantAnalyticsMetrics({
      aiSearches: 8421,
      productViews: 19821,
      checkoutClicks: 1419,
      orders: 102,
      attributedGmvMinor: 18_432_000,
      netRevenueMinor: 17_900_000,
      measured: true,
      checkoutClicksBySurface: {
        chatgpt: 1022,
        web: 298,
        gemini: 50,
        brand_widget: 49,
      },
    });

    expect(metrics.aiSearches).toBe(8421);
    expect(metrics.productViews).toBe(19821);
    expect(metrics.checkoutClicks).toBe(1419);
    expect(metrics.orders).toBe(102);
    expect(metrics.attributedGmvMinor).toBe(18_432_000);
    expect(metrics.searchToCheckoutRate).toBeCloseTo(1419 / 8421);
    expect(metrics.checkoutToOrderRate).toBeCloseTo(102 / 1419);
    expect(metrics.surfaceBreakdown.counts).toEqual({
      chatgpt: 1022,
      web: 298,
      other: 99,
    });
    expect(metrics.surfaceBreakdown.shares.chatgpt).toBeCloseTo(1022 / 1419);
    expect(metrics.surfaceBreakdown.shares.web).toBeCloseTo(298 / 1419);
    expect(metrics.surfaceBreakdown.shares.other).toBeCloseTo(99 / 1419);
  });

  it('does not invent order metrics when conversion tracking is not configured', () => {
    const metrics = buildMerchantAnalyticsMetrics({
      aiSearches: 0,
      productViews: 3,
      checkoutClicks: 0,
      orders: 9,
      attributedGmvMinor: 999_00,
      netRevenueMinor: 999_00,
      measured: false,
      checkoutClicksBySurface: {},
    });

    expect(metrics.orders).toBeNull();
    expect(metrics.attributedGmvMinor).toBeNull();
    expect(metrics.netRevenueMinor).toBeNull();
    expect(metrics.searchToCheckoutRate).toBeNull();
    expect(metrics.checkoutToOrderRate).toBeNull();
    expect(metrics.surfaceBreakdown.shares).toEqual({
      chatgpt: 0,
      web: 0,
      other: 0,
    });
  });
});
