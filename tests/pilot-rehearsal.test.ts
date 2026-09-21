import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  acceptanceFrom,
  failureReport,
  isRehearsalDatabaseName,
  percentile,
  type RehearsalMetrics,
  renderSummary,
  type ScenarioResult,
  seededRandom,
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
  noResultRate: 1 / 202,
  searchErrorRate: 1 / 203,
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
  'search-outcomes',
  'real-mcp-transport',
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
      realMcpTransportTests: 1,
    });
    expect(verdictFrom(acceptance)).toBe('PASS');
    expect(
      verdictFrom(
        acceptanceFrom({
          metrics: { ...metrics, searchAttempts: 201 },
          scenarios,
          webJourneys: 50,
          chatgptJourneys: 50,
          realMcpTransportTests: 1,
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
      realMcpTransportTests: 1,
    });
    expect(
      renderSummary({
        metrics,
        acceptance,
        verdict: 'PASS',
        webJourneys: 50,
        chatgptJourneys: 50,
        realMcpTransportTests: 1,
      }),
    ).toContain('does not satisfy TASK-023B');
  });

  it('keeps outcome rates and MCP transport evidence explicit in the summary', () => {
    const acceptance = acceptanceFrom({
      metrics,
      scenarios,
      webJourneys: 50,
      chatgptJourneys: 50,
      realMcpTransportTests: 1,
    });
    const summary = renderSummary({
      metrics,
      acceptance,
      verdict: 'PASS',
      webJourneys: 50,
      chatgptJourneys: 50,
      realMcpTransportTests: 1,
    });
    expect(summary).toContain('ChatGPT-attributed:     50 PASS');
    expect(summary).toContain('Real MCP transport:     1 PASS');
    expect(summary).toContain('No-result rate:         0.50%');
    expect(summary).toContain('Search-error rate:      0.49%');
  });

  it('emits a machine-readable setup failure and preserves database-name safety', () => {
    const report = failureReport({
      seed: 23,
      runMode: 'ci',
      phase: 'database-preparation',
      startedAt: new Date('2026-09-17T10:00:00.000Z'),
      finishedAt: new Date('2026-09-17T10:00:01.000Z'),
      error: 'database unavailable',
    });
    expect(report).toMatchObject({
      schemaVersion: 'shopai-pilot-rehearsal/v1',
      phase: 'database-preparation',
      verdict: 'FAIL',
      error: 'database unavailable',
    });
    expect(isRehearsalDatabaseName('shopai_pilot_rehearsal_ci')).toBe(true);
    expect(isRehearsalDatabaseName('shopai_test')).toBe(false);
    expect(isRehearsalDatabaseName('production')).toBe(false);
  });

  it('marks a newly created rehearsal database before migrations begin', async () => {
    const runner = await readFile(
      new URL('../scripts/pilot-rehearsal.mts', import.meta.url),
      'utf8',
    );
    const placeholder = '$' + '{databaseName}';
    const createAt = runner.indexOf(`create database ${placeholder}`);
    const markerAt = runner.indexOf(`comment on database ${placeholder}`);
    const migrateAt = runner.indexOf('await migrate(database.db');
    expect(createAt).toBeGreaterThan(-1);
    expect(markerAt).toBeGreaterThan(createAt);
    expect(migrateAt).toBeGreaterThan(markerAt);
    expect(runner).toContain(
      'Existing database is not marked as a ShopAI rehearsal database.',
    );
  });
});
