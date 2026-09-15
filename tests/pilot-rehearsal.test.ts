import { describe, expect, it } from 'vitest';
import {
  acceptanceFrom,
  percentile,
  renderSummary,
  seededRandom,
  type RehearsalMetrics,
  type ScenarioResult,
  verdictFrom,
} from '../scripts/pilot-rehearsal-lib.js';

const metrics: RehearsalMetrics = {
  requestCount: 10,
  successCount: 9,
  errorCount: 1,
  p50LatencyMs: 2,
  p95LatencyMs: 8,
  merchantCount: 5,
  productCount: 10_040,
  shopperJourneys: 100,
  catalogLoads: 100,
  searchAttempts: 200,
  explicitSearches: 100,
  refinements: 100,
  paginationRequests: 100,
  productViews: 100,
  checkoutClicks: 50,
  conversionCallbacks: 20,
  attributedOrders: 10,
  attributedGmvMinor: 100_000,
  netRevenueMinor: 90_000,
  noResultRate: 0,
  searchErrorRate: 0,
  checkoutClickRate: 0.25,
  conversionAttributionRate: 0.5,
  syncFailures: 1,
  staleCatalogWarnings: 1,
  tenantIsolationViolations: 0,
};

const requiredIds = [
  'synthetic-merchant-mix',
  'connector-pagination-10k',
  'search-taxonomy',
  'product-detail',
  'save-unsave',
  'checkout-attribution',
  'conversion-signatures',
  'refund-cancel',
  'merchant-analytics',
  'upstream-429',
  'upstream-5xx',
  'retry-exhaustion',
  'retried-sync',
  'incremental-sync-updates',
  'stale-catalog',
  'expired-redirect',
  'tampered-redirect',
  'private-merchant',
  'cross-tenant',
  'deterministic-seed',
];
const scenarios: ScenarioResult[] = requiredIds.map((id) => ({
  id,
  status: 'pass',
  details: {},
}));

describe('pilot rehearsal reporting', () => {
  it('keeps seeded generation deterministic and calculates nearest-rank latency', () => {
    expect(Array.from({ length: 5 }, seededRandom(23))).toEqual(
      Array.from({ length: 5 }, seededRandom(23)),
    );
    expect(percentile([9, 1, 5, 3, 7], 0.5)).toBe(5);
    expect(percentile([9, 1, 5, 3, 7], 0.95)).toBe(9);
  });

  it('derives PASS from assertions instead of hard-coding it', () => {
    const acceptance = acceptanceFrom({
      metrics,
      scenarios,
      webJourneys: 50,
      chatgptJourneys: 50,
    });
    expect(verdictFrom(acceptance)).toBe('PASS');
    expect(
      verdictFrom(
        acceptanceFrom({
          metrics: { ...metrics, searchAttempts: 201 },
          scenarios,
          webJourneys: 50,
          chatgptJourneys: 50,
        }),
      ),
    ).toBe('FAIL');
  });

  it('prints the mandatory synthetic limitation', () => {
    const acceptance = acceptanceFrom({
      metrics,
      scenarios,
      webJourneys: 50,
      chatgptJourneys: 50,
    });
    expect(
      renderSummary({
        metrics,
        acceptance,
        verdict: 'PASS',
        webJourneys: 50,
        chatgptJourneys: 50,
      }),
    ).toContain('does not satisfy TASK-023B');
  });
});
