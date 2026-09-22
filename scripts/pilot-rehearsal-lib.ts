export const REPORT_SCHEMA_VERSION = 'shopai-pilot-rehearsal/v1' as const;

export function rehearsalMcpSearchArguments(merchantId: string) {
  return {
    merchantIds: [merchantId],
    query: 'Synthetic',
    analyticsIntent: 'explicit_search' as const,
    // This probe verifies the MCP transport and response envelope. Keeping the
    // default inStockOnly=true would also make it a wall-clock freshness test:
    // a slow rehearsal can age otherwise valid fixtures past the 15m window.
    inStockOnly: false,
    limit: 3,
  };
}

export function isRehearsalDatabaseName(value: string) {
  return /^shopai_(?:pilot_)?rehearsal(?:_[a-z0-9_]+)?$/u.test(value);
}

export type ScenarioResult = {
  id: string;
  status: 'pass' | 'fail';
  details: Record<string, unknown>;
  error?: string;
};

export type RehearsalMetrics = {
  requestCount: number;
  successCount: number;
  errorCount: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  merchantCount: number;
  productCount: number;
  shopperJourneys: number;
  catalogLoads: number;
  searchAttempts: number;
  explicitSearches: number;
  refinements: number;
  paginationRequests: number;
  productViews: number;
  checkoutClicks: number;
  conversionCallbacks: number;
  attributedOrders: number;
  attributedGmvMinor: number;
  netRevenueMinor: number;
  noResultRate: number;
  searchErrorRate: number;
  checkoutClickRate: number;
  conversionAttributionRate: number;
  syncFailures: number;
  staleCatalogWarnings: number;
  tenantIsolationViolations: number;
};

export type Acceptance = {
  merchantScale: boolean;
  catalogScale: boolean;
  shopperScale: boolean;
  surfaces: boolean;
  searchTaxonomy: boolean;
  productDetail: boolean;
  checkoutAttribution: boolean;
  failureRecovery: boolean;
  tenantIsolation: boolean;
  deterministicExecution: boolean;
};

export type TransportCoverage = {
  webRestJourneys: number;
  chatgptAttributedJourneys: number;
  realMcpTransportTests: number;
};

export function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function percentile(values: readonly number[], quantile: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(quantile * sorted.length) - 1),
  );
  return Math.round((sorted[index] ?? 0) * 100) / 100;
}

export function acceptanceFrom(input: {
  metrics: RehearsalMetrics;
  scenarios: readonly ScenarioResult[];
  webJourneys: number;
  chatgptJourneys: number;
  realMcpTransportTests: number;
}) {
  const passed = new Set(
    input.scenarios
      .filter((scenario) => scenario.status === 'pass')
      .map((scenario) => scenario.id),
  );
  const all = (...ids: string[]) => ids.every((id) => passed.has(id));
  const metrics = input.metrics;
  const acceptance: Acceptance = {
    merchantScale: metrics.merchantCount === 5 && all('synthetic-merchant-mix'),
    catalogScale:
      metrics.productCount >= 10_000 && all('connector-pagination-10k'),
    shopperScale: metrics.shopperJourneys >= 100,
    surfaces:
      input.webJourneys > 0 &&
      input.chatgptJourneys > 0 &&
      input.realMcpTransportTests > 0 &&
      all('real-mcp-transport'),
    searchTaxonomy:
      all('search-taxonomy', 'search-outcomes') &&
      metrics.searchAttempts === metrics.explicitSearches + metrics.refinements,
    productDetail:
      metrics.productViews > 0 && all('product-detail', 'save-unsave'),
    checkoutAttribution:
      metrics.checkoutClicks > 0 &&
      metrics.conversionCallbacks > 0 &&
      all(
        'checkout-attribution',
        'conversion-signatures',
        'refund-cancel',
        'merchant-analytics',
      ),
    failureRecovery: all(
      'upstream-429',
      'upstream-5xx',
      'retry-exhaustion',
      'retried-sync',
      'incremental-sync-updates',
      'stale-catalog',
      'expired-redirect',
      'tampered-redirect',
    ),
    tenantIsolation:
      metrics.tenantIsolationViolations === 0 &&
      all('private-merchant', 'cross-tenant'),
    deterministicExecution: all('deterministic-seed'),
  };
  return acceptance;
}

export function verdictFrom(acceptance: Acceptance) {
  return Object.values(acceptance).every(Boolean) ? 'PASS' : 'FAIL';
}

export function renderSummary(input: {
  metrics: RehearsalMetrics;
  acceptance: Acceptance;
  verdict: 'PASS' | 'FAIL';
  webJourneys: number;
  chatgptJourneys: number;
  realMcpTransportTests: number;
}) {
  const mark = (value: boolean) => (value ? 'PASS' : 'FAIL');
  const successRate = input.metrics.requestCount
    ? (input.metrics.successCount / input.metrics.requestCount) * 100
    : 0;
  return [
    'ShopAI Synthetic Pilot Rehearsal',
    '',
    `Synthetic merchants:   ${input.metrics.merchantCount}/5 ${mark(input.acceptance.merchantScale)}`,
    `Catalog scale:          ${input.metrics.productCount.toLocaleString('en-US')} ${mark(input.acceptance.catalogScale)}`,
    `Shopper journeys:       ${input.metrics.shopperJourneys} ${mark(input.acceptance.shopperScale)}`,
    `Web/REST journeys:      ${input.webJourneys} ${mark(input.webJourneys > 0)}`,
    `ChatGPT-attributed:     ${input.chatgptJourneys} ${mark(input.chatgptJourneys > 0)}`,
    `Real MCP transport:     ${input.realMcpTransportTests} ${mark(input.realMcpTransportTests > 0)}`,
    `Search taxonomy:        ${mark(input.acceptance.searchTaxonomy)}`,
    `Product detail:         ${mark(input.acceptance.productDetail)}`,
    `Checkout attribution:   ${mark(input.acceptance.checkoutAttribution)}`,
    `Retry / chaos paths:    ${mark(input.acceptance.failureRecovery)}`,
    `Tenant isolation:       ${mark(input.acceptance.tenantIsolation)}`,
    '',
    `Requests:               ${input.metrics.requestCount}`,
    `Success rate:           ${successRate.toFixed(2)}%`,
    `p50 latency:            ${input.metrics.p50LatencyMs.toFixed(2)} ms`,
    `p95 latency:            ${input.metrics.p95LatencyMs.toFixed(2)} ms`,
    `No-result rate:         ${(input.metrics.noResultRate * 100).toFixed(2)}%`,
    `Search-error rate:      ${(input.metrics.searchErrorRate * 100).toFixed(2)}%`,
    '',
    `Verdict: ${input.verdict}`,
    '',
    'NOTE:',
    'This is a synthetic rehearsal.',
    'It does not satisfy TASK-023B real merchant/user acceptance.',
  ].join('\n');
}

export function failureReport(input: {
  seed?: number;
  runMode?: string;
  phase: string;
  startedAt: Date;
  finishedAt: Date;
  error: string;
}) {
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    mode: 'synthetic' as const,
    runMode: input.runMode ?? 'unknown',
    seed: input.seed ?? null,
    startedAt: input.startedAt.toISOString(),
    finishedAt: input.finishedAt.toISOString(),
    durationMs: input.finishedAt.getTime() - input.startedAt.getTime(),
    phase: input.phase,
    verdict: 'FAIL' as const,
    error: input.error,
  };
}
