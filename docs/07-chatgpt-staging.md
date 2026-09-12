# TASK-011 — Hosted ChatGPT staging

Son güncelleme: 11 Eylül 2026

## Durum

Repo tarafındaki hosted staging sözleşmesi hazırlanmıştır. **Gerçek ChatGPT kabul testi henüz PASS sayılmaz.** Kabul ancak public HTTPS deployment çalıştıktan ve gerçek bir ChatGPT developer-mode oturumunda aşağıdaki kanıtlar toplandıktan sonra tamamlanır.

Bu ayrım bilinçlidir: local MCP, CI entegrasyon testi veya doğrudan HTTP smoke testi tek başına “ChatGPT içinde çalışıyor” kanıtı değildir.

## Güncel uygulama sözleşmesi

- MCP server: `shopai` / `0.4.0`
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
ChatGPT
  |
  | HTTPS streamable HTTP
  v
api.staging.<domain>/mcp
  |
  +--> ShopAI API :4000
  |
  +--> signed /r/... redirect

ChatGPT widget iframe
  |
  | HTTPS public immutable assets
  v
widget.staging.<domain>/assets/widget-v3.{js,css}

Internet :80/:443
  |
  v
Caddy TLS edge
  +--> api:4000
  +--> widget:3001
```

Caddy ACME/TLS sonlandırır. API ve widget container'ları doğrudan internete açılmaz. Widget runtime DB, Redis, pilot auth veya redirect signing secret almaz; yalnız public build assetlerini servis eder.

## GitHub `staging` environment sözleşmesi

Canlı secret değerleri repoya veya `.env.example` içine yazılmaz.

### Variables

- `STAGING_API_ORIGIN` — ör. `https://api.staging.<domain>`; path/query içermeyen origin.
- `STAGING_WIDGET_ORIGIN` — ör. `https://widget.staging.<domain>`; path/query içermeyen origin.
- `STAGING_TLS_EMAIL` — ACME iletişim adresi.
- `STAGING_ALLOWED_ORIGINS` — en az `https://chatgpt.com`; gerekiyorsa `https://chat.openai.com` da eklenir.
- `STAGING_RESOURCE_DOMAINS` — widget origin + pilot katalogdaki gerçek image originleri. Yalnız public HTTPS originler.
- `STAGING_MERCHANT_ID` — pilot merchant UUID.
- `STAGING_BACKUP_DIR` — staging hostta güvenli backup dizini.

### Secrets

- `STAGING_DATABASE_URL`
- `STAGING_REDIS_URL`
- `STAGING_REDIRECT_SIGNING_SECRET`
- `STAGING_AUTH_PILOT_CREDENTIALS`
- `STAGING_CONVERSION_CALLBACK_SECRET` — opsiyonel; boşsa callback kapalıdır.

Secret'lar GitHub Environment üzerinden workflow runtime'ına enjekte edilir; image build argümanı veya repository dosyası olarak saklanmaz.

## Host ve DNS ön koşulları

- GitHub Actions self-hosted runner: `shopai-staging` label'ı.
- Runner hostta Docker ve Docker Compose.
- API ve widget host adları için staging hosta giden A/AAAA kayıtları.
- ACME için inbound TCP 80 ve 443; HTTP/3 kullanılacaksa UDP 443.
- Staging PostgreSQL ve Redis production'dan ayrılmış olmalı.
- Hosted smoke için katalogda en az bir published ürün bulunmalı.
- Checkout testi için en az bir selectable/purchasable offer bulunmalı.
- Pilot merchant image originleri `STAGING_RESOURCE_DOMAINS` içinde olmalı; çoklu merchant image proxy/CDN stratejisi UI-001 kapsamındadır.

## Deployment akışı

`.github/workflows/staging.yml` manuel `workflow_dispatch` ile çalışır ve `staging` GitHub Environment'ını kullanır.

1. Required variable/secret adlarını fail-closed doğrula.
2. API/widget originlerinin HTTPS ve origin-only olduğunu doğrula.
3. `https://chatgpt.com` CORS allowlist'ini zorunlu tut.
4. Compose config'i validate et.
5. Current commit için immutable GHCR image üret ve push et; rollback'te mevcut SHA tag'i seç.
6. Migration öncesi staging DB backup al.
7. Migration'ı ayrı `migrate` role ile bir kez uygula.
8. `api`, `worker`, `web`, `widget`, `edge` servislerini deploy et.
9. Public API ve widget HTTPS readiness'i bekle.
10. `scripts/staging-chatgpt-smoke.mjs` ile hosted MCP/widget smoke'u çalıştır.

Hosted smoke şu zinciri doğrular:

```text
https://chatgpt.com CORS preflight
  -> public /mcp
  -> tools/list
  -> search_products
  -> UI resource + CSP
  -> public widget-v3.js/css
  -> get_product_detail
  -> signed ShopAI /r/... checkout
  -> merchant redirect Location
```

Bu smoke gerçek ChatGPT iframe render'ını veya browser console'unu taklit ettiğini iddia etmez.

## Gerçek ChatGPT kabul testi

OpenAI'nin plugin test akışına göre public MCP server HTTPS üzerinden erişilebilir olmalı ve public bağlantı URL'si `/mcp` path'ini içermelidir. Developer mode ChatGPT Settings → Security and login altında etkinleştirilir; ardından ChatGPT Plugins ekranından public MCP bağlantısı eklenir.

Kaynak:
- https://developers.openai.com/plugins/deploy/connect-chatgpt
- https://developers.openai.com/plugins/build/chatgpt-ui

### Test adımları

1. Staging workflow PASS ve release SHA kaydedilmiş olmalı.
2. ChatGPT → Settings → Security and login → Developer mode açık olmalı.
3. ChatGPT Plugins → `+` → Connection'a `${STAGING_API_ORIGIN}/mcp` ekle.
4. Discovered tool listesinde `search_products` ve `get_product_detail` görünmeli.
5. Yeni konuşmada ShopAI connection'ını seç.
6. Prompt: `Siyah oversize tişört göster.`
7. Beklenen:
   - `search_products` çağrılır;
   - visual widget render olur;
   - structured renk/beden/kategori/fiyat filtreleri çalışır;
   - `Oversize` yalnız `Arama bağlamı` olarak görünür.
8. Bir üründe `İncele` seç:
   - `get_product_detail` çağrılır;
   - varyant/stok/detail UI render olur.
9. Satın alınabilir varyantta `Satın Al` seç:
   - external navigation ChatGPT host API üzerinden bir kez açılır;
   - ilk href signed ShopAI `/r/...` URL'sidir;
   - son hedef merchant checkout'tur.
10. Browser/plugin console ve network panelinde CSP, CORS, mixed-content, MIME veya blocked-resource hatası olmamalı.
11. En az bir gerçek merchant image'ı görünmeli; görünmüyorsa origin `STAGING_RESOURCE_DOMAINS` ile karşılaştırılır ve UI-001'e evidence eklenir.

OpenAI ayrıca UI'nın console error olmadan render edilmesini test öncesi kontrol maddesi olarak belirtir. UI resource URI breaking HTML/JS/CSS değişikliklerinde yeni bir cache key olarak versionlanmalıdır; TASK-011 bu yüzden v3 resource + v3 asset kullanır.

## Kabul evidence kaydı

Aşağıdaki tablo doldurulmadan TASK-011 complete sayılmaz:

| Kanıt | Sonuç |
| --- | --- |
| Workflow run URL | PENDING |
| Release SHA | PENDING |
| Public MCP `${STAGING_API_ORIGIN}/mcp` | PENDING |
| Hosted automated smoke | PENDING |
| ChatGPT connection created | PENDING |
| `search_products` selected | PENDING |
| Widget rendered | PENDING |
| `get_product_detail` selected | PENDING |
| External checkout opened | PENDING |
| Console/CSP/CORS errors | PENDING |
| Tester + timestamp | PENDING |

## Mevcut blocker

11 Eylül 2026 itibarıyla repository geçmişinde `workflow_dispatch` ile çalıştırılmış bir staging deployment run'ı yoktur. Bu yüzden staging runner'ın online olduğu, DNS kayıtlarının gerçek hosta baktığı ve `staging` GitHub Environment variable/secret'larının tanımlı olduğu henüz kanıtlanmış değildir.

TASK-011 branch/PR merge edilmeden önce en az bir hosted workflow PASS ve gerçek ChatGPT developer-mode acceptance evidence'i eklenmelidir.
