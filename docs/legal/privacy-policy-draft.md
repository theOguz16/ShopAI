# ShopAI Privacy Policy — DRAFT

> **Status:** Legal/owner review required. Do not publish as final until every placeholder is completed and applicable KVKK/GDPR obligations are reviewed.

Last draft update: 2026-09-15

## 1. Data controller

Data controller / service operator:

- Legal name: **[COMPANY / PERSON LEGAL NAME]**
- Address: **[ADDRESS]**
- Contact email: **[PRIVACY CONTACT EMAIL]**
- Country / jurisdiction: **[JURISDICTION]**

## 2. What ShopAI does

ShopAI is an AI-assisted commerce discovery service. It lets shoppers discover merchant products through supported surfaces such as the web and ChatGPT, then sends the shopper to the merchant's own product/checkout flow. ShopAI does not process card payments in the current pilot.

## 3. Data we process

Depending on the feature used, ShopAI may process:

- product catalog data supplied by merchants: title, description, category, variants, price, stock status, product URL and product images;
- pseudonymous discovery-session identifiers and attribution metadata such as surface, transport, merchant, search/click identifiers, campaign and timestamps;
- explicit anonymous shopping preferences, saved products and alert settings when the shopper chooses to use those features;
- account/session information for merchant dashboard users;
- signed merchant conversion snapshots limited to order identifier, attributed click identifier, value and currency;
- operational security data such as request IDs, failure events and service health metadata.

The pilot is designed not to require payment-card data, shopper shipping address, merchant customer lists or full order/webhook bodies.

## 4. Why we process data

Data is processed to:

- provide product search, filtering, product detail and merchant handoff;
- maintain accurate price, stock and catalog information;
- provide saved-product and price/stock alert features requested by the shopper;
- measure discovery → product → merchant handoff → purchase attribution where enabled;
- provide merchant analytics;
- secure, debug and operate the service;
- comply with legal obligations and investigate abuse.

Applicable legal bases must be confirmed for the actual operating entity and target countries before publication.

## 5. Cookies and pseudonymous identifiers

ShopAI may use first-party, HttpOnly/SameSite cookies or equivalent identifiers to maintain authentication and anonymous shopping state. Behavioral advertising profiles are not part of the current pilot design.

## 6. Merchant data and third-party destinations

A shopper who opens a merchant product or checkout leaves ShopAI and enters the merchant's service. The merchant's own privacy policy then applies to activity on that destination.

Merchant catalog credentials are stored server-side. Managed connector credentials are encrypted at rest; the browser receives neither the raw credential nor its internal secret reference.

## 7. Service providers and transfers

ShopAI may use infrastructure, email-delivery, error-monitoring/alerting and AI/model providers needed to operate the service. The final policy must list the actual production providers, processing locations and transfer safeguards before launch.

Production provider list: **[FILL BEFORE PUBLICATION]**

## 8. Retention

Current technical defaults are:

- completed/failed raw import and outbox operational data: approximately 7 days;
- pseudonymous redirect/click records: approximately 30 days;
- attributed conversion/order aggregate snapshots: approximately 365 days;
- expired application sessions: short operational grace period before deletion;
- backups: separate limited retention policy, currently targeted at approximately 14 days.

These periods may be shortened or legally held when required. Final retention periods must match the executed merchant agreement and applicable law.

## 9. Security

ShopAI uses measures including HTTPS, tenant isolation controls, rate limiting, signed attribution/conversion flows, encrypted connector secrets, access-controlled production secrets, backups and operational monitoring. No security control eliminates all risk.

## 10. Individual rights

Depending on applicable law, individuals may have rights to request information, access, correction, deletion, restriction, objection, portability or withdrawal of consent. The final policy must describe the real request channel and statutory process for the operating entity.

Privacy request contact: **[PRIVACY CONTACT EMAIL]**

## 11. Children

The pilot is not intentionally designed for children. The final age rule must be confirmed for the jurisdictions in which ShopAI is offered.

## 12. Changes

Material policy changes should be versioned, dated and published before they take effect where required.

## Publication gate

Before this document becomes the public Privacy Policy:

- [ ] controller identity/contact completed;
- [ ] production processors/providers listed;
- [ ] KVKK/GDPR and cross-border transfer analysis completed where applicable;
- [ ] retention matches actual infrastructure and merchant contract;
- [ ] rights-request process exists operationally;
- [ ] legal/authorized owner approval recorded.
