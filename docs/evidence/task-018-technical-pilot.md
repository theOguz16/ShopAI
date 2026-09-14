# TASK-018 — Technical Pilot Evidence

Date: 2026-09-14

Staging release under test: `9293ee7afdf2cca4111ecc90f7d7b9bf9cf211f0`

## Result

**Technical pilot: PASS**

**External real-merchant validation: PENDING**

This run used a LocalWP WooCommerce rehearsal store populated with synthetic pilot fixtures. It validates the technical integration and scale path, but it does not satisfy the separate requirement for an independent real merchant with production-hosted catalog/assets.

## Catalog and sync evidence

Final full sync observed in the merchant dashboard:

- Products found: **544**
- Products processed: **544**
- Failed: **0**
- Variants/offers observed: **796**
- Product-level import coverage: **544 / 544 = 100%**
- WooCommerce connection health: **Healthy**

The rehearsal catalog included simple and variable products, in-stock and out-of-stock inventory, sale prices, multiple images, and missing-data cases.

Incremental sync was also exercised with price/discount, stock and product-content changes and propagated those changes without catalog-count corruption. Repeated scheduled jobs completed successfully after the final run.

## ChatGPT / MCP discovery and handoff

The staging MCP flow found a fresh in-stock WooCommerce product through the default ChatGPT surface and returned a signed ShopAI redirect.

Observed path:

`ChatGPT/MCP search -> ShopAI search result -> signed redirect -> human click -> WooCommerce product page`

Attribution stored the click with:

- `transport = mcp`
- `surface = chatgpt`
- human classification

The current WooCommerce handoff target is the source product permalink. It is not a direct cart/checkout URL; checkout remains merchant-owned after the handoff.

## Merchant analytics evidence

Merchant analytics showed:

- AI Searches: **6**
- Checkout Clicks: **2**
- Orders: **0**
- Search -> Checkout: **33.3%**
- ChatGPT surface share: **100% (2 clicks)**
- Web: **0 clicks**
- Other: **0 clicks**

This proves that a human click originating from ChatGPT/MCP is visible in the merchant-facing ShopAI analytics dashboard.

## Acceptance status

| Check | Status |
| --- | --- |
| 500+ product catalog | PASS |
| Full sync completes | PASS |
| >=99% product import success | PASS (100%) |
| Variable products / variants | PASS |
| Out-of-stock handling | PASS |
| Sale / price update propagation | PASS |
| Missing-data cases | PASS |
| Incremental sync | PASS |
| Scheduled sync | PASS |
| ChatGPT/MCP product discovery | PASS |
| Signed merchant handoff | PASS |
| Human click attribution | PASS |
| Merchant dashboard sees ChatGPT click | PASS |
| Independent real WooCommerce merchant | PENDING |

## Remaining formal validation

Before TASK-018 can be claimed as an external real-merchant acceptance test, repeat the same path against a permitted independent WooCommerce merchant with a stable public store/domain and public product assets.

The LocalWP rehearsal and temporary public tunnel should not be treated as production-readiness evidence. No attributed order or GMV was produced in this run.
