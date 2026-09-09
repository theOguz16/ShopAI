# ChatGPT staging doğrulama kaydı

Son güncelleme: 9 Eylül 2026

## Uygulama sözleşmesi

- MCP server: `shopai` / `0.2.0`
- MCP SDK: `@modelcontextprotocol/sdk` / `1.30.0`
- UI standardı: MCP Apps, `ui/*` JSON-RPC köprüsü
- Widget asset: `widget-v1.js`
- Tool DTO: `schemaVersion: 1`
- UI resource: `ui://widget/shopai-products-v1.html`
- Yerel doğrulama: demo katalog, `http://127.0.0.1:4000/mcp`, widget `http://127.0.0.1:3001`

## Staging kapıları

`CATALOG_MODE=postgres` kullanıldığında `MCP_PUBLIC_ORIGIN` ve `WIDGET_ORIGIN` HTTPS olmak zorundadır. `MCP_ALLOWED_ORIGINS` yalnız gerçek host originlerini; `WIDGET_RESOURCE_DOMAINS` yalnız public widget ve ürün görseli originlerini içermelidir. Özel obje deposu veya yönetim API originleri CSP listesine eklenmez.

## Gerçek ChatGPT oturum testi

- Durum: çalıştırılmadı
- ChatGPT hesap/workspace: sağlanmadı
- Staging TLS MCP URL: sağlanmadı
- Staging widget origin: sağlanmadı
- Beklenen senaryo: `search_products` çağrısı kartları açar; beden `M` → `L` değişimi `tools/call` ile yeniden arar; sonuç yok/hata durumları görünür; widget yüklenmezse metin sonucu kullanılabilir kalır.

Bu kayıt, hesap ve staging erişimi olmadan gerçek ChatGPT kabul kriterinin geçmiş gibi sunulmaması için bilinçli olarak açık bırakılmıştır.

## 9 Eylül 2026 kabul girişimi

- Test edilen sürüm: belirlenemedi; staging release SHA sağlanmadı.
- TLS staging: doğrulanamadı; API, web, MCP ve widget URL'leri sağlanmadı.
- Gerçek ChatGPT host: doğrulanamadı; yetkili hesap/workspace ve erişilebilir host oturumu bulunmadı.
- İlk widget yükleme ve ilk arama: çalıştırılmadı.
- Filtreyle tekrar arama: çalıştırılmadı.
- Timeout/hata görünümü: canlı hostta çalıştırılmadı.
- Ürün yönlendirmesi: çalıştırılmadı.
- Rollback provası: çalıştırılmadı; staging runner, deployment erişimi, mevcut/önceki release SHA ve workflow run URL'si yok.
- Ortam kontrolü: `STAGING_API_URL`, `STAGING_WEB_URL`, `MCP_PUBLIC_ORIGIN`, `WIDGET_ORIGIN`, `CHATGPT_WORKSPACE_ID`, `STAGING_RELEASE_SHA`, `DATABASE_URL` ve `REDIS_URL` yapılandırılmamıştı. Erişilebilir tarayıcı yüzeyinde staging veya ChatGPT host sekmesi yoktu.

Sonuç: kabul tamamlanmadı ve hiçbir staging/gerçek-host maddesi geçmiş olarak işaretlenmedi.
