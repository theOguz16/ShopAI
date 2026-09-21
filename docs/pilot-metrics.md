# ShopAI pilot metrics taxonomy

This document is the canonical measurement vocabulary for the pilot. It maps logical product events to the authoritative server-side data that already exists instead of duplicating critical commerce events into a second generic event stream.

## Principles

- `surface` answers where the shopper interacted: `web`, `chatgpt`, `gemini`, `brand_widget`.
- `transport` answers how the request reached ShopAI: `rest`, `mcp`, `ucp`.
- A storefront page opening is not a search.
- Pagination is not a new search attempt.
- Critical funnel events use server-authoritative sources. Browser telemetry must not manufacture merchant handoffs, checkout starts or conversions.
- Raw shopper query text is not stored in analytics event rows.
- Metrics use `[from,to)` time windows and merchant tenancy remains enforced by DB RLS.

## Canonical logical events

| Logical event | Authoritative source | Counting rule |
| --- | --- | --- |
| `discovery_session_started` | `discovery_sessions` | One created discovery session. Carries surface, transport, merchant scope and optional campaign/referrer. |
| `catalog_loaded` | `search_events` | `request_kind = 'initial'` and `intent = 'catalog_load'`. Used for non-user-initiated catalog visibility such as branded storefront initial load. Never contributes to search attempts. |
| `search_performed` | `search_events` | `request_kind = 'initial'` and `intent in ('explicit_search','refinement')`. This is the pilot search KPI numerator/denominator source. |
| `search_refined` | `search_events` | Initial request with `intent = 'refinement'`. Subset of `search_performed`. |
| `results_paginated` | `search_events` | `request_kind = 'pagination'`. Cursor continuation only; not a new search attempt. |
| `product_opened` | `product_view_events` | Successful product-detail open recorded by the server. |
| `category_selected` | `interaction_events` | A committed category choice. One row per affected merchant. UI rerenders do not count; a retry reuses the same globally unique client `eventKey` and is deduplicated. |
| `filter_applied` | `interaction_events` | A committed size/color/price/stock/attribute filter action. One row per filter kind and affected merchant; retry uses the same `eventKey`. Raw filter values are not stored. |
| `product_impression` | `interaction_events` | A product first rendered in one result response. Variant/offer duplicates collapse to one `(merchant, product)` impression for that render; pagination/new render is a new impression. Retry of the event batch reuses `eventKey`. |
| `merchant_handoff` | `redirect_clicks` | `classification = 'human'`. The destination may be a product page or a checkout URL; this event alone is never called a checkout start. Bot/preview redirects are separate. |
| `conversion_received` | `conversion_orders` | Verified merchant callback order. Funnel attribution requires search + offer attribution and excludes cancelled orders from order/GMV metrics. |
| `product_saved` | `interaction_events` | Created only after the authoritative save succeeds. Uses saved-record ID as `eventKey`, so duplicate save calls do not double-count; history remains after unsave. |
| `alert_created` | `interaction_events` | Created only after authoritative alert creation succeeds. Uses alert ID as `eventKey`, so an idempotent create does not double-count; history remains after cancel. Email, target price and recipient are not copied to analytics. |

## Scope, safety and retention

- Every row has server time, validated surface/transport, discovery session and exactly one merchant. Global/multi-merchant result sets fan out into one event row per affected merchant; there is no ambiguous nullable “global merchant”. Product IDs are checked against that merchant.
- The interaction contract accepts only the five event types above and at most 50 events/request. REST ingestion is limited to 30 requests/minute; the widget MCP tool remains under the MCP endpoint's global 60 requests/minute limit. Globally unique `eventKey` is the retry/idempotency boundary. Neither path can write `redirect_clicks` or `conversion_orders`; those remain server-authoritative redirect and signed merchant callback paths.
- No raw query, filter value, email, anonymous/user ID, campaign or referrer is copied into `interaction_events`. Session linkage provides the minimum attribution join.
- Interaction events are retained for 90 days by `infra/retention.sh`; the append-only DB role has no update/delete grant. Legal hold or an executed agreement may require a reviewed policy change.

## Search intent semantics

`search_events.request_kind` remains for backward compatibility and distinguishes `initial` vs `pagination`. It also remains the compatibility authority for historical pagination rows.

`search_events.intent` is the metric-grade semantic field:

- `catalog_load`: automatic/non-user-initiated catalog retrieval. The API accepts this only for an empty/absent query; a non-empty query tagged as `catalog_load` is recorded as `explicit_search`.
- `explicit_search`: the first user-initiated search in an interaction flow.
- `refinement`: a later user-initiated search that changes/reuses query or filters.
- `pagination`: cursor continuation. The server assigns this whenever a cursor is present, regardless of a client-provided analytics hint.

The branded storefront emits `catalog_load` for its automatic empty-query request, `explicit_search` for the first form submission, and `refinement` for later submissions. Retry preserves the intent of the failed request.

## Merchant dashboard definitions

- `aiSearches` / `searchAttempts` = initial `explicit_search + refinement` requests.
- `catalogLoads` = initial `catalog_load`, reported separately.
- `paginationRequests` = `request_kind = 'pagination'`, reported separately.
- `noResultRate` = empty successful user searches / successful user searches.
- `searchErrorRate` = failed user searches / all user search attempts.
- `merchantHandoffs` = human redirect requests to a merchant-controlled product or checkout URL.
- `searchToMerchantHandoffRate` = human merchant handoffs / user search attempts.
- `merchantHandoffToOrderRate` = attributed non-cancelled orders / human merchant handoffs.
- `checkoutClicks`, `searchToCheckoutRate`, `checkoutToOrderRate` and `surfaceBreakdown` remain response aliases for existing API clients. They carry the same merchant-handoff counts and must not be interpreted as proof that a checkout screen or session started.
- `attributedGmvMinor` = gross value of attributed non-cancelled orders before refunds.
- `netRevenueMinor` = attributed gross minus recorded refunds.

### Session funnel and repeat behavior

The dashboard reports event totals and the ordered session funnel separately. Event totals answer “how many times did this happen?” and therefore include repeated user searches, detail opens and human handoffs. Session funnel stages answer “how many distinct sessions reached this point?” and count a discovery session at most once per stage.

The cohort is merchant-related discovery sessions created inside the selected `[from,to)` range. A session is merchant-related when its merchant scope contains the merchant or it has a merchant event in the range. To advance, the same session must contain these events in order and inside the same reporting range:

1. initial `explicit_search` or `refinement`;
2. a product detail open at or after that search;
3. a human merchant handoff at or after that detail open;
4. a verified, attributed, non-cancelled conversion at or after that handoff.

Repeated events do not increase a session-stage numerator. `catalog_load` does not satisfy search. Bot/preview redirects never satisfy handoff. A cancelled order does not satisfy purchase. A refunded order remains a historical attributed purchase, while its refund reduces `netRevenueMinor` (a full refund can therefore produce zero net revenue). The endpoint permits at most a 93-day report interval; all cohort and stage timestamps must fall in the requested interval, so events outside it are not pulled into the funnel.

`repeatSessionRate` means anonymous identifiers with at least two merchant-related cohort sessions divided by anonymous identifiers with at least one. It is not a person-level retention metric: clearing cookies, private browsing, switching devices/surfaces, and MCP clients that do not carry a stable identifier split one person into multiple identities; shared identifiers can have the opposite effect. No probabilistic identity stitching is performed.

When the merchant has no enabled signed conversion integration, `purchasedSessions`, `handoffToPurchaseRate` and `sessionToPurchaseRate` are `null` and the UI says **Ölçülmüyor**. They are never displayed as zero merely because purchase telemetry is unavailable.

## Historical cutoff

Migration `0026_search_intent_metrics` adds `intent` with the conservative default `explicit_search`, then deterministically backfills every historical `request_kind = 'pagination'` row to `intent = 'pagination'`.

Older initial search rows did not persist enough information to reliably identify which branded-storefront empty-query requests were automatic page loads. Those initial rows are intentionally not guessed/backfilled as `catalog_load`; they remain `explicit_search`.

For clean catalog-load-vs-user-search reporting, use data recorded after the release containing migration `0026`, or explicitly annotate earlier initial-search periods as pre-taxonomy data. Historical pagination counts remain correct across the migration boundary.
