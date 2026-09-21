# TASK-011 — Hosted ChatGPT staging

Son güncelleme: 21 Eylül 2026

## Durum

Görevlerin kanonik mühendislik/dış kabul durumu `docs/06-implementation-status.md` içindedir. Bu belge hosted koşunun operasyon kaydıdır.

ShopAI hosted staging'in gerçek public sunucuya deploy edildiği ve aşağıdaki manuel smoke zincirinin geçtiği kaydedilmiştir. İlk manuel smoke'un exact SHA/run URL kanıtı eksikti. 21 Eylül gerçek host koşusunda readiness endpoint'i güncel deployed SHA'yı `cb74208776afb998139ac4211a2477bea543068b` olarak doğruladı; kalıcı workflow/run URL'si hâlâ yoktur.

Public HTTPS, MCP endpoint, widget assetleri, product search, product detail ve signed external checkout hosted smoke testi başarıyla geçmiştir.

Gerçek ChatGPT Plus hesabında Developer Mode açılarak private ShopAI MCP uygulaması 21 Eylül 2026'da bağlandı. Arama, iframe/widget render, filtre, doğrudan detay/varyant ve merchant handoff çalıştı. Kabul yine de tamamlanmadı: karttan detail hata verdi, saved read-after-write sürekliliği başarısız oldu, host `CSP kapalı` gösterdi, gerçek ürün görseli ve ekran kaydı yoktu. Ayrıntı `docs/evidence/task-011b-real-chatgpt-host.md` içindedir.

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

TASK-011 kapsamındaki ilk staging deployment manuel olarak doğrulanmış, fakat o koşunun exact SHA/run URL'si kaydedilmemiştir. 21 Eylül TASK-011B koşusu deployed SHA'yı readiness üzerinden sonradan doğrulamıştır; workflow/run URL eksikliği sürer.

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
| Release SHA | PASS — readiness `cb74208776afb998139ac4211a2477bea543068b` döndürdü |
| Workflow / run URL | **Eksik:** manuel smoke için kalıcı run URL kaydedilmemiş. |
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
| Real ChatGPT iframe render | KISMİ — arama/filter PASS; karttan detail FAIL, direct detail DTO uyumsuzluk uyarılı |
| Real ChatGPT console/CSP testi | FAIL — host `CSP kapalı`; ShopAI-domain filtreli console eşleşmesi yok, hostta çok sayıda ilgisiz i18n hata kaydı var |
| Web / ChatGPT identity continuity | FAIL — save başarı yanıtı sonrası iki list çağrısı boş; no-auth MCP web cookie ile bağlı değil |
| Screen recording | EKSİK |

Hosted smoke sonucu:

```json
{
  "status": "ok",
  "release": "cb74208776afb998139ac4211a2477bea543068b",
  "mcpUrl": "https://shop.fizyoflow.com/mcp",
  "resourceUri": "ui://widget/shopai-shopping-v3.html",
  "searchTool": true,
  "widgetAssets": true,
  "productDetail": true,
  "signedExternalCheckout": true
}
```

## Mevcut blocker

Hosted staging kod/manuel smoke akışında bilinen blocker yoktur. Exact deployed SHA ve kalıcı run URL eksikliği auditable release acceptance blocker'ıdır.

Developer Mode erişim engeli kalkmıştır. Koşu sonrasında CSP enforcement kullanıcı onayıyla açılmıştır; yeni release üzerinde tekrar kanıtlanması gerekir. Güncel blocker'lar detail ve stateful saved düzeltmelerinin gerçek host tekrar koşusu, web/ChatGPT identity süreksizliği, gerçek görsel/timeout koşusu ve ekran kaydıdır. Account-linking takibi `docs/follow-ups/task-024-account-linking.md` içindedir.

TASK-011 kod kapsamını bu bulgular geriye döndürmez; TASK-011B dış kabulü bütün maddeler aynı release üzerinde kanıtlanana kadar açık kalır.
