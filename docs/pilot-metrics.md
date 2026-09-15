# ShopAI pilot metrics taxonomy

This document is the canonical measurement vocabulary for the pilot. It maps logical product events to the authoritative server-side data that already exists instead of duplicating critical commerce events into a second generic event stream.

## Principles

- `surface` answers where the shopper interacted: `web`, `chatgpt`, `gemini`, `brand_widget`.
- `transport` answers how the request reached ShopAI: `rest`, `mcp`, `ucp`.
- A storefront page opening is not a search.
- Pagination is not a new search attempt.
- Critical funnel events use server-authoritative sources. Browser telemetry must not manufacture checkout clicks or conversions.
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
| `checkout_clicked` | `redirect_clicks` | `classification = 'human'`. Bot/preview redirects are reported separately and excluded from conversion funnel clicks. |
| `conversion_received` | `conversion_orders` | Verified merchant callback order. Funnel attribution requires search + offer attribution and excludes cancelled orders from order/GMV metrics. |
| `product_saved` | `saved_products` | Current saved state has `created_at`; this is not an immutable historical event after a save is deleted. Do not use it as a historical funnel numerator without a dedicated append-only event. |
| `alert_created` | product-alert persistence | Current alert state is operational/user state, not part of the primary search-to-order pilot funnel. If historical alert-creation analytics becomes a KPI, add an append-only event rather than inferring from current state. |

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
- `searchToCheckoutRate` = human checkout clicks / user search attempts.
- `checkoutToOrderRate` = attributed non-cancelled orders / human checkout clicks.
- `attributedGmvMinor` = gross value of attributed non-cancelled orders before refunds.
- `netRevenueMinor` = attributed gross minus recorded refunds.

## Historical cutoff

Migration `0026_search_intent_metrics` adds `intent` with the conservative default `explicit_search`, then deterministically backfills every historical `request_kind = 'pagination'` row to `intent = 'pagination'`.

Older initial search rows did not persist enough information to reliably identify which branded-storefront empty-query requests were automatic page loads. Those initial rows are intentionally not guessed/backfilled as `catalog_load`; they remain `explicit_search`.

For clean catalog-load-vs-user-search reporting, use data recorded after the release containing migration `0026`, or explicitly annotate earlier initial-search periods as pre-taxonomy data. Historical pagination counts remain correct across the migration boundary.
