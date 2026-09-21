# TASK-011 — Hosted ChatGPT staging

Son güncelleme: 21 Eylül 2026

## Durum

Görevlerin kanonik mühendislik/dış kabul durumu `docs/06-implementation-status.md` içindedir. Bu belge hosted koşunun operasyon kaydıdır.

ShopAI hosted staging gerçek public sunucuya deploy edilmiştir. Güncel readiness release'i `af1646aa85e6da3ff94df430a6ec4c16cf69adcb` olup repository HEAD ile aynıdır. Hosted smoke exact SHA üzerinde PASS; kalıcı staging doğrulama kaydı https://github.com/theOguz16/ShopAI/actions/runs/35637005952 adresindedir.

Public HTTPS, MCP endpoint, widget assetleri, product search, product detail ve signed external checkout hosted smoke testi başarıyla geçmiştir.

Gerçek ChatGPT Plus hesabında Developer Mode ile private ShopAI MCP uygulaması bağlandı. İlk koşunun widget hydration hatası PR #43 ile düzeltildi; arama ve detail/varyant gerçek hostta PASS. Yetkilendirmesiz/stateless ChatGPT çağrılarında saved principal continuity yoktur ve TASK-024 account linking gerektirir. Sentetik ve açıkça etiketli kabul görselleri hosted smoke'ta origin, MIME, CORS ve CORP ile PASS; gerçek ChatGPT iframe tekrar koşusu, kontrollü timeout, kalıcı console/CSP kaydı ve ekran kaydı eksiktir. Ayrıntı `docs/evidence/task-011b-real-chatgpt-host.md` içindedir.

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

İlk gerçek staging deployment manuel olarak doğrulanmış olarak kaydedilmiştir; exact SHA/run URL sonradan belgeye eklenmemiştir. Host üzerindeki `.env.staging` dosyası repository dışında tutulur ve `0600` izinle korunur.

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

İlk staging deployment'in tarihsel run URL'si eksiktir. Güncel tekrar deploy'u immutable `af1646aa85e6da3ff94df430a6ec4c16cf69adcb` image'ı, migration, container recreation, readiness ve public hosted smoke ile doğrulanmıştır.

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

Deploy edilen runtime release üzerinde hosted smoke PASS vermiştir.

GitHub Actions üzerinden production-like deployment otomasyonu TASK-021 Production Readiness kapsamında standardize edilecektir.

## Gerçek ChatGPT kabul testi

Private Developer Mode bağlantısı artık erişilebilir ve gerçek Plus hesabında kullanılmıştır. 21 Eylül koşusu acceptance adımlarının bir bölümünü geçti; bu koşu App Directory publication veya production end-user kabulü değildir.

Kalan acceptance adımları:

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
| Release SHA | PASS — readiness `af1646aa85e6da3ff94df430a6ec4c16cf69adcb` döndürdü |
| Workflow / run URL | PASS — https://github.com/theOguz16/ShopAI/actions/runs/35637005952; public hosted smoke exact SHA üzerinde PASS |
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
| Real ChatGPT iframe render | PASS — PR #43 sonrası yeni çağrıda arama ve ilk ürün detail/varyant akışı geçti |
| Real ChatGPT console/CSP testi | EKSİK — CSP enforcement `on`; yeni release için kalıcı ShopAI-origin console/rozet kaydı henüz yok |
| Web / ChatGPT identity continuity | Beklenen sınırlama — stateless no-auth çağrılarda save/list principal korunmuyor; davranış açık, TASK-024 OAuth/account linking gerekir |
| Screen recording | EKSİK |

Hosted smoke sonucu:

```json
{
  "status": "ok",
  "release": "af1646aa85e6da3ff94df430a6ec4c16cf69adcb",
  "mcpUrl": "https://shop.fizyoflow.com/mcp",
  "resourceUri": "ui://widget/shopai-shopping-v3.html",
  "searchTool": true,
  "widgetAssets": true,
  "demoProductImage": true,
  "productDetail": true,
  "signedExternalCheckout": true
}
```

## Mevcut blocker

Hosted staging kod/hosted smoke akışında bilinen blocker yoktur; exact deployed SHA doğrulanmıştır.

Developer Mode erişim engeli kalkmıştır. CSP enforcement kullanıcı onayıyla açılmıştır. Sentetik kabul görseli hosted origin/MIME/CORS/CORP testini geçmiştir. Güncel blocker'lar görselin gerçek ChatGPT iframe tekrar koşusu, yeni release için kalıcı console/CSP kaydı, kontrollü timeout ve ekran kaydıdır. Stateless ChatGPT çağrıları ile web yüzeyi arasındaki principal sürekliliği `docs/follow-ups/task-024-account-linking.md` kapsamındadır.

TASK-011 kod kapsamını bu bulgular geriye döndürmez; TASK-011B dış kabulü bütün maddeler aynı release üzerinde kanıtlanana kadar açık kalır.
