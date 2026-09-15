# TASK-018 — Technical Pilot Evidence

Date: 2026-09-14

Staging release under test: `9293ee7afdf2cca4111ecc90f7d7b9bf9cf211f0`

## Result

**Technical rehearsal / pilot: PASS**

**External real-merchant validation: PENDING**

This run used a LocalWP WooCommerce rehearsal store populated with synthetic pilot fixtures. It validates the technical integration and scale path, but it does not satisfy the separate requirement for an independent real merchant with production-hosted catalog/assets.

This evidence is also separate from the moderated user-study pilot described in `docs/pilot-brief.md`; it does not claim the 5-user × 5-task usability thresholds from that document were executed or passed.

## Catalog and sync evidence

Final full sync observed in the merchant dashboard:

- Products found: **544**
- Products processed: **544**
- Failed: **0**
- Dashboard `Varyant` counter: **796**
- Product-level import coverage: **544 / 544 = 100%**
- WooCommerce connection health at evidence capture: **Healthy**

The `Varyant` progress counter is the worker's normalized source-row count (`rows.length`), so **796 must not be interpreted as 796 distinct WooCommerce variation entities**. The rehearsal catalog did include both simple and variable products.

The rehearsal fixture also covered in-stock and out-of-stock inventory, sale prices, multiple images and missing-data cases.

Incremental sync was exercised with price/discount, stock and product-content changes and propagated those changes without catalog-count corruption. After the final validation, three consecutive scheduled sync jobs for the rehearsal connection completed successfully on release `9293ee7afdf2cca4111ecc90f7d7b9bf9cf211f0`.

## ChatGPT / MCP discovery and merchant handoff

The staging MCP flow found a fresh in-stock WooCommerce product through the ChatGPT surface and returned a signed ShopAI redirect.

Observed path:

`ChatGPT/MCP search -> ShopAI search result -> signed redirect -> human click -> WooCommerce product page`

Attribution stored the click with:

- `transport = mcp`
- `surface = chatgpt`
- human classification

The current WooCommerce handoff target is the source product permalink. It is **not** a direct cart or checkout URL. Therefore this run proves merchant handoff to the WooCommerce product page, not that a merchant-owned cart/checkout screen was opened.

## Merchant analytics evidence

Merchant analytics showed:

- AI Searches: **6**
- Product Views: **0**
- Checkout Clicks: **2**
- Orders: **0**
- Attributed GMV: **₺0**
- Net Attributed Revenue: **₺0**
- Search -> Checkout: **33.3%**
- ChatGPT surface share: **100% (2 clicks)**
- Web: **0 clicks**
- Other: **0 clicks**

`Checkout Clicks` and `Search -> Checkout` are the dashboard's current labels for signed merchant-handoff redirect events. In this WooCommerce integration those redirects land on the source product permalink, so these metrics must not be read as confirmed checkout-session starts.

This proves that human handoff clicks originating from ChatGPT/MCP are visible in the merchant-facing ShopAI analytics dashboard.

## Acceptance status

| Check | Status |
| --- | --- |
| 500+ product catalog | PASS |
| Full sync completes | PASS |
| >=99% product import success | PASS (100%) |
| Simple + variable product coverage | PASS |
| Out-of-stock handling | PASS |
| Sale / price update propagation | PASS |
| Missing-data cases | PASS |
| Incremental sync | PASS |
| Scheduled sync | PASS |
| ChatGPT/MCP product discovery | PASS |
| Signed handoff to WooCommerce product page | PASS |
| Human click attribution | PASS |
| Merchant dashboard sees ChatGPT handoff click | PASS |
| Direct merchant cart/checkout page opened | NOT VERIFIED |
| Independent real WooCommerce merchant | PENDING |
| Public merchant-hosted product URLs/assets | PENDING |
| Attributed order / GMV | NOT OBSERVED |

## Remaining formal validation

Before TASK-018 can be claimed as an external real-merchant acceptance test, repeat the same path against a permitted independent WooCommerce merchant with:

- a stable public store/domain;
- publicly routable product and image URLs;
- valid read-only WooCommerce API credentials;
- source-to-ShopAI catalog reconciliation;
- the same ChatGPT/MCP discovery and signed handoff verification;
- merchant-owned add-to-cart/checkout verification if the acceptance criterion requires a literal checkout screen rather than product-page handoff.

The LocalWP rehearsal used a temporary public tunnel for API access while source product/assets remained local-development URLs. That is sufficient for the technical rehearsal performed here, but not for independent internet-routability or production-readiness evidence.

No attributed order or GMV was produced in this run.

## Post-run cleanup

After the final evidence was captured, the rehearsal WooCommerce connection was marked inactive before LocalWP and the temporary tunnel were shut down. This prevents the five-minute scheduler from generating expected failures against an intentionally offline rehearsal source. The stored catalog and analytics evidence remain available for review.
