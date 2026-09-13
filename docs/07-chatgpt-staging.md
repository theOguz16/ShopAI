# TASK-011 — Hosted ChatGPT staging

Son güncelleme: 13 Eylül 2026

## Durum

ShopAI hosted staging gerçek public sunucuda deploy edilmiştir.

Public HTTPS, MCP endpoint, widget assetleri, product search, product detail ve signed external checkout hosted smoke testi başarıyla geçmiştir.

Gerçek ChatGPT iframe/widget acceptance testi mevcut ChatGPT Plus hesabında private custom MCP Developer Mode erişimi bulunmadığı için pre-publication aşamasında çalıştırılamamaktadır.

Bu test App Directory publication sonrasında Plus hesabıyla gerçek son kullanıcı akışında yapılacaktır. Bu nedenle hosted deployment engineering acceptance PASS, gerçek ChatGPT host UI acceptance ise DEFERRED durumundadır.

## Güncel uygulama sözleşmesi

- MCP server: `shopai` / `0.5.0`
- Public MCP endpoint: `${STAGING_API_ORIGIN}/mcp`
- UI resource: `ui://widget/shopai-shopping-v3.html`
- Widget JS: `${STAGING_WIDGET_ORIGIN}/assets/widget-v3.js`
- Widget CSS: `${STAGING_WIDGET_ORIGIN}/assets/widget-v3.css`
- UI MIME: `text/html;profile=mcp-app`
- Tool DTO: `schemaVersion: 1`
- ChatGPT surface attribution: `transport=mcp`, `surface=chatgpt`
- Checkout: ChatGPT hostta `window.openai.openExternal({ href, redirectUrl: false })`; `href` ShopAI signed `/r/...` URL'sidir.

## Hosted topoloji

```text
Internet
   |
   +--> https://shop.fizyoflow.com
   |          |
   |        Nginx
   |          |
   |    127.0.0.1:4400
   |          |
   |      ShopAI API
   |          |
   |        /mcp
   |
   +--> https://widget.fizyoflow.com
              |
            Nginx
              |
        127.0.0.1:4500
              |
        ShopAI Widget
```

TLS host Nginx + Certbot tarafından sonlandırılır.

ShopAI API ve widget containerları doğrudan public portlara bind edilmez; yalnız localhost portları Nginx'e açılır.

Staging PostgreSQL ve Redis ayrı Docker containerlarında ve `shopai-staging-net` networkünde çalışır.

## GitHub `staging` environment sözleşmesi

Canlı secret değerleri repoya commit edilmez.

İlk gerçek staging deployment manuel olarak doğrulanmıştır. Host üzerindeki `.env.staging` dosyası repository dışında tutulur ve `0600` izinle korunur.

Production-like otomatik deployment ve secret-management standardizasyonu TASK-021 Production Readiness kapsamında tamamlanacaktır.

## Host ve DNS ön koşulları

- `shop.fizyoflow.com` ve `widget.fizyoflow.com` staging hosta resolve olmalı.
- Host Nginx TCP 80/443 üzerinde çalışmalı.
- Certbot TLS sertifikaları geçerli olmalı.
- ShopAI API yalnız `127.0.0.1:4400` üzerinden hosta açılmalı.
- ShopAI widget yalnız `127.0.0.1:4500` üzerinden hosta açılmalı.
- Staging PostgreSQL ve Redis diğer uygulamalardan izole olmalı.
- Hosted smoke için en az bir published product bulunmalı.
- Checkout testi için en az bir purchasable offer bulunmalı.

## Deployment akışı

TASK-011 kapsamında gerçek staging deployment manuel olarak doğrulanmıştır.

Doğrulanan akış:

```text
Git commit SHA
  -> immutable local Docker image
  -> staging DB migration
  -> api / worker / web / widget
  -> host Nginx
  -> public HTTPS
  -> hosted MCP smoke
```

Hosted smoke aşağıdaki zinciri doğrular:

```text
ChatGPT-origin CORS
  -> public /mcp
  -> tools/list
  -> search_products
  -> UI resource + CSP
  -> widget-v3.js/css
  -> get_product_detail
  -> signed ShopAI /r/... checkout
  -> merchant redirect
```

Release `53b51a157d81be36446d4c5078d68073b0db56b9` üzerinde hosted smoke PASS vermiştir.

GitHub Actions üzerinden production-like deployment otomasyonu TASK-021 Production Readiness kapsamında standardize edilecektir.

## Gerçek ChatGPT kabul testi

Pre-publication gerçek ChatGPT iframe/widget acceptance testi erişim nedeniyle DEFERRED durumundadır.

Mevcut ChatGPT Plus hesabında private custom MCP uygulamasını doğrudan bağlayacak Developer Mode / custom connection seçeneği bulunmamaktadır.

App review ve publication sonrasında ShopAI, aynı Plus hesabıyla gerçek son kullanıcı gibi test edilecektir.

Publication sonrası acceptance adımları:

1. Published ShopAI app açılır.
2. `search_products` çağrısı doğrulanır.
3. Widget gerçek ChatGPT iframe ortamında render edilir.
4. Facet/filter etkileşiminin yeni MCP search çağrısı yaptığı doğrulanır.
5. `get_product_detail` çağrısı ve variant/stok UI kontrol edilir.
6. `window.openai.openExternal` signed ShopAI `/r/...` redirect URL'sini açar.
7. Son hedef merchant checkout olur.
8. Browser console'da CSP, CORS, mixed-content, MIME veya blocked-resource hatası bulunmadığı doğrulanır.
9. Gerçek merchant image originleri iframe içinde kontrol edilir.
10. Web ve ChatGPT surface'leri arasında Shopping Profile, Saved Products ve Alerts identity continuity test edilir.

Identity iki surface arasında korunmuyorsa explicit account linking veya OAuth tasarlanacaktır.

## Kabul evidence kaydı

| Kanıt | Sonuç |
| --- | --- |
| Release SHA | `53b51a157d81be36446d4c5078d68073b0db56b9` |
| Public API health | PASS |
| Public widget health | PASS |
| Public MCP `/mcp` | PASS |
| ChatGPT-origin CORS | PASS |
| MCP `tools/list` | PASS |
| `search_products` | PASS |
| Widget resource/assets | PASS |
| `get_product_detail` | PASS |
| Signed external checkout | PASS |
| Hosted automated smoke | PASS |
| Real ChatGPT iframe render | DEFERRED - publication sonrası |
| Real ChatGPT console/CSP testi | DEFERRED - publication sonrası |
| Web / ChatGPT identity continuity | DEFERRED - publication sonrası |

Hosted smoke sonucu:

```json
{
  "status": "ok",
  "release": "53b51a157d81be36446d4c5078d68073b0db56b9",
  "mcpUrl": "https://shop.fizyoflow.com/mcp",
  "resourceUri": "ui://widget/shopai-shopping-v3.html",
  "searchTool": true,
  "widgetAssets": true,
  "productDetail": true,
  "signedExternalCheckout": true
}
```

## Mevcut blocker

Hosted staging engineering tarafında blocker kalmamıştır.

Gerçek ChatGPT iframe/widget acceptance testi yalnızca mevcut Plus hesabında private custom MCP Developer Mode erişimi bulunmadığı için publication sonrasına ertelenmiştir.

Bu deferred validation TASK-011 hosted staging engineering acceptance'ını bloklamaz. App Directory publication sonrası release validation maddesi olarak takip edilecektir.
