# TASK-023A synthetic pilot rehearsal

`pnpm pilot:rehearsal` runs a deterministic, production-shaped rehearsal and
writes `artifacts/pilot-rehearsal/report.json` plus `summary.txt`. The default
seed is `23001`; use `pnpm pilot:rehearsal -- --seed=23002` to select another
repeatable dataset. `--mode=ci` records CI intent but deliberately keeps all
required scale and functional checks.

The command uses a dedicated PostgreSQL database named
`shopai_pilot_rehearsal` by default at the local Compose address. Start local
infrastructure with `pnpm infra:up`. A different dedicated database can be
provided through `PILOT_REHEARSAL_DATABASE_URL` or `--database-url=...`, but
the database name must begin with `shopai_rehearsal` or
`shopai_pilot_rehearsal`. The runner refuses arbitrary database names. It
recreates an existing database only when the previous run left the explicit
database comment or legacy `shopai_pilot_rehearsal_marker` table. The database
comment is written immediately after database creation, before migrations, so
an interrupted first setup can be safely recreated on the next run. A matching
name without either marker is still refused and never dropped.

## Simulated

- Five deterministic, tenant-isolated merchants, including one private store
  and one merchant with two provider connections.
- WooCommerce-like and Trendyol Product V2-like upstream responses through the
  production connector classes. The upstream HTTP services and credentials are
  synthetic boundaries; neither contacts an external merchant.
- 10,050 products in one large merchant plus small catalogs for the other
  merchants. Product identity, category, size, color, price, inventory, image
  availability and checkout URLs vary deterministically.
- One hundred shoppers split evenly between web/REST and ChatGPT-shaped
  attribution. These direct service journeys validate persisted
  `surface=chatgpt` / `transport=mcp` attribution but are not described as HTTP
  MCP transport tests. A separate `/mcp` JSON-RPC `tools/call` scenario invokes
  the real `search_products` transport path, and both counts are reported
  independently. The shoppers, clicks, orders, refunds and cancellations are
  generated evidence, not people or commercial activity.
- Checkout destinations under `checkout.synthetic.invalid`. No payment or
  external request is made.

The large bootstrap uses set-based PostgreSQL inserts because fixture creation
is privileged setup. Small catalogs and the retried job scenario use the real
catalog import transaction. This avoids turning the production row-oriented
import API into a parallel fake importer while keeping the 10k setup bounded.

## Real ShopAI paths exercised

- The complete migration chain, PostgreSQL schema, restricted public role and
  tenant RLS.
- Production discovery sessions, canonical public search, cursor pagination,
  product detail and product-view persistence.
- TASK-022 `catalog_load`, `explicit_search`, `refinement` and `pagination`
  event persistence. Assertions prove that only explicit search plus
  refinement enter `searchAttempts`. Controlled empty-result and rejected
  search requests ensure `noResultRate` and `searchErrorRate` are non-zero and
  calculated from persisted `search_events.outcome` rows rather than constants.
- Redirect HMAC creation/verification, published-offer resolution, human click
  attribution and click persistence.
- Merchant-derived conversion signatures, conversion persistence,
  cancellation exclusion and refund-aware net revenue semantics.
- WooCommerce pagination and bounded retry behavior for `429 + Retry-After`,
  transient `5xx`, and retry exhaustion.
- Import idempotency for an interrupted/retried job and the production catalog
  stale-health threshold.

Every required acceptance field is derived from recorded metrics and scenario
assertions. A failed required field produces `verdict: "FAIL"` and a non-zero
exit status; PASS is not hard-coded. Failures before scenario execution also
write a minimal machine-readable `report.json` with `verdict`, failure phase
and error whenever the artifact directory is writable. CI uploads both report
and summary with `if: always()` so FAIL evidence is retained.

## Not validated

- Real WooCommerce merchant acceptance or source reconciliation.
- A real Trendyol seller or real seller credential acceptance.
- Real consumer traffic, usability feedback or adoption.
- A payment processor, real checkout or real purchase.
- Merchant willingness to pay, incremental sales or real-world reliability.
- TASK-023B / issue #38. It remains pending and is not satisfied by this
  rehearsal.

Runtime reports are ignored by Git. The report includes the seed, timestamps,
scale, explicit attribution-vs-real-MCP transport coverage, request latency
distribution, TASK-022 outcome-derived metrics, conversion metrics, scenario
evidence, acceptance booleans, limitations and the final verdict.
