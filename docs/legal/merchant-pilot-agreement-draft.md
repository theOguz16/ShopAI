# ShopAI Merchant Pilot Agreement — DRAFT

> **Status:** Commercial/legal draft only. Must be completed and signed by authorized parties before a real merchant production pilot is treated as accepted.

Last draft update: 2026-09-15

## Parties

Service operator: **[SHOPAI LEGAL NAME / ADDRESS]**

Merchant: **[MERCHANT LEGAL NAME / ADDRESS / TAX INFO IF REQUIRED]**

Effective date: **[DATE]**

Pilot term: **[START / END OR TERMINATION RULE]**

## 1. Pilot purpose

The parties agree to test ShopAI's product-discovery, catalog synchronization, analytics and merchant-handoff functionality using the Merchant's authorized catalog. The pilot is intended to evaluate technical reliability and commercial usefulness; it is not a guarantee of sales volume.

## 2. Merchant authorization and credentials

The Merchant authorizes ShopAI to access only the merchant platform/account and scopes explicitly supplied for the pilot. Where supported, credentials should be read-only and limited to catalog/stock/price access.

ShopAI will not request the Merchant to commit credentials to source code or send them through public channels. Managed connector credentials are stored server-side and encrypted at rest.

The Merchant may revoke credentials or terminate connector access at any time, subject to agreed offboarding steps.

## 3. Catalog/content license

For the pilot term, the Merchant grants ShopAI a limited, non-exclusive, revocable license to ingest, normalize, cache and display authorized catalog content solely to operate and evaluate the pilot, including:

- product names and descriptions;
- categories and variants;
- prices and stock state;
- product URLs;
- product images and image metadata.

The Merchant represents that it has sufficient rights to provide and authorize this content. ShopAI receives no ownership in Merchant content.

## 4. Shopper handoff and purchases

ShopAI sends shoppers to Merchant-controlled product/checkout destinations. Unless separately agreed in writing, ShopAI is not the merchant of record, does not set the final sale price, does not process payment-card data and is not responsible for fulfillment, returns, consumer warranties or Merchant tax obligations.

## 5. Attribution and conversion measurement

The Merchant permits ShopAI to create signed/pseudonymous discovery and click identifiers for attribution. If conversion measurement is enabled, Merchant may send the minimum signed conversion fields defined by the integration, such as:

- ShopAI click identifier;
- Merchant order identifier;
- order value;
- currency.

The Merchant must not include shopper name, email, shipping address, payment-card data or unrelated webhook/order payload fields unless the parties execute a separate approved data-processing scope.

## 6. Analytics

ShopAI may provide pilot analytics such as searches, product views, merchant handoff/checkout clicks, attributed orders, attributed GMV and conversion rates. Metrics are operational estimates and may be affected by blockers, browser/platform behavior, attribution windows or integration gaps.

## 7. Data retention and deletion

Unless a signed amendment requires different periods, the technical pilot targets limited retention such as:

- raw import/outbox operational data: approximately 7 days;
- pseudonymous redirect/click records: approximately 30 days;
- attributed order aggregate snapshots: approximately 365 days;
- backups: limited operational retention, currently targeted at approximately 14 days.

At termination, ShopAI will revoke/disable connector access and apply the agreed deletion/retention process, subject to legal obligations, security logs and backup lifecycle.

## 8. Security and incident handling

ShopAI will use reasonable pilot controls including HTTPS, tenant isolation, access control, rate limiting, encrypted connector secrets, signed conversion callbacks, backups and operational monitoring.

Security contact ShopAI: **[SECURITY CONTACT]**

Security contact Merchant: **[MERCHANT SECURITY CONTACT]**

Incident notification timing and method: **[COUNSEL / PARTIES TO DEFINE]**

## 9. Merchant responsibilities

Merchant is responsible for:

- supplying authorized and accurate catalog access;
- maintaining lawful product listings and required consumer disclosures;
- informing ShopAI of credential revocation, domain/API changes or material catalog changes;
- ensuring any conversion callback data is authorized and limited to the agreed schema;
- reviewing pilot analytics before relying on them for accounting or legal reporting.

## 10. Fees and commercial terms

Pilot fee / revenue share / free pilot terms: **[FILL OR STATE FREE PILOT]**

Taxes/invoicing: **[FILL IF APPLICABLE]**

No commercial term should be inferred from this template.

## 11. Confidentiality

Each party should protect non-public credentials, business information, technical information and security information received from the other party and use it only for the pilot. Approved exceptions and duration: **[COUNSEL TO COMPLETE]**.

## 12. Intellectual property

Each party retains its pre-existing intellectual property. Feedback rights, pilot-created materials and branding permissions: **[PARTIES TO COMPLETE]**.

## 13. Warranty, liability and indemnity

**[COUNSEL TO INSERT APPROVED LANGUAGE FOR THE ACTUAL PARTIES AND JURISDICTION]**

Do not launch a paid or material production pilot with this section incomplete.

## 14. Termination

Either party may terminate the pilot on **[NOTICE PERIOD]** written notice. Immediate suspension/termination may apply for credential compromise, unlawful use, security risk or material breach.

Offboarding should include credential revocation, connector disablement, confirmation of retention/deletion rules and return/removal of any Merchant-provided confidential material as applicable.

## 15. Governing law and signatures

Governing law / venue: **[JURISDICTION]**

### ShopAI

Authorized name/title: **[NAME / TITLE]**

Signature/date: **[SIGNATURE / DATE]**

### Merchant

Authorized name/title: **[NAME / TITLE]**

Signature/date: **[SIGNATURE / DATE]**

## Pilot acceptance gate

Before TASK-021/TASK-023 treats a real merchant as contractually ready:

- [ ] all party details completed;
- [ ] catalog/image license approved;
- [ ] attribution/conversion scope approved;
- [ ] retention/deletion terms match technical settings;
- [ ] security/incident contacts completed;
- [ ] fee/commercial terms completed;
- [ ] liability/confidentiality/jurisdiction language approved;
- [ ] both authorized parties signed.
