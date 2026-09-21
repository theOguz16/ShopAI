# TASK-011B — Gerçek ChatGPT host kabul kaydı

Tarih: 21 Eylül 2026 (Europe/Istanbul)

## Sonuç

**KISMİ / KAPI AÇIK.** Yetkili gerçek ChatGPT Plus hesabında Developer Mode ile ShopAI özel uygulaması bağlıdır. İlk koşuda bulunan initial tool-output hydration hatası PR #43 ile düzeltildi ve gerçek hostta yeniden arama ve ürün detayı geçti. `af1646aa85e6da3ff94df430a6ec4c16cf69adcb` release'inde sentetik kabul görseli hosted smoke ile origin, MIME, CORS ve CORP düzeyinde geçti; gerçek ChatGPT iframe tekrar koşusu henüz kaydedilmedi. Saved kimliği yetkilendirmesiz/stateless ChatGPT tool çağrıları arasında korunmuyor; ürün bu davranışı açıkça raporluyor ve account-linking TASK-024'tür. Kontrollü timeout, ShopAI-origin console/CSP kaydı ve ekran kaydı hâlâ eksik olduğu için görev kapatılamaz.

## Release ve host kanıtı

- Staging readiness: `https://shop.fizyoflow.com/health/ready`
- İlk koşu release'i: `cb74208776afb998139ac4211a2477bea543068b`
- Düzeltme tekrar koşusu release'i: `c4cebb9906aa6c4c1aaf012dde8c20875891b1d6`
- Güncel hosted görsel kabul release'i: `af1646aa85e6da3ff94df430a6ec4c16cf69adcb`
- Exact-release staging workflow: https://github.com/theOguz16/ShopAI/actions/runs/35637005952
- Düzeltme release readiness sonucu: `status=ok`, exact release SHA
- Hosted smoke: search tool, widget assets, product detail ve signed external handoff PASS
- CI: https://github.com/theOguz16/ShopAI/actions/runs/35602033609 (PASS)
- Test edilen MCP: `https://shop.fizyoflow.com/mcp`
- UI resource: `ui://widget/shopai-shopping-v3.html`
- ChatGPT uygulama kimliği: `asdk_app_6ab0ce99252081919ba9f97a7a0b1aaf`
- ChatGPT uygulama sürüm kimliği: `asdk_app_v_6ab0ce99252c81918b4c2955f8f7e9f8`
- ChatGPT konuşması: `https://chatgpt.com/c/6ab0cf3a-3f44-83ed-a36f-2feac5da1fdc`
- Hesap sınıfı: gerçek ChatGPT Plus hesabı; kişisel hesap ayrıntıları bu belgeye yazılmadı.

REV-001–007 [PR #42](https://github.com/theOguz16/ShopAI/pull/42) ile `023f1a2` olarak merge edildi. Real-host hydration düzeltmesi [PR #43](https://github.com/theOguz16/ShopAI/pull/43), görsel eşleme düzeltmesi [PR #46](https://github.com/theOguz16/ShopAI/pull/46) ve widget görsel servisi [PR #47](https://github.com/theOguz16/ShopAI/pull/47) ile merge edildi. Staging uygulama release'i `af1646aa85e6da3ff94df430a6ec4c16cf69adcb`'dir; sonraki commitler yalnız kabul belgelerini günceller.

## Senaryo sonuçları

| Senaryo | Sonuç | Gözlem |
|---|---|---|
| Developer Mode / private app | PASS | ShopAI oluşturuldu; ChatGPT `Success: ShopAI şimdi bağlandı` gösterdi. |
| Tool keşfi | PASS | 8 eylem ve `ui://widget/shopai-shopping-v3.html` şablonu gerçek hostta listelendi. |
| Arama | PASS | `search_products` çalıştı; 3 sentetik ürün döndü. |
| Widget render | PASS | Gerçek ChatGPT sandbox iframe'i render edildi. |
| Filtreleme | PASS | Siyah filtresi 3 ürünü 1 ürüne indirdi. |
| Sonuç kartından/detail tool akışı | PASS (tekrar koşusu) | PR #43 sonrası yeni gerçek-host çağrısında arama sonucu ve ilk ürün detayı başarıyla açıldı; M varyantı, fiyat ve stok raporlandı. Eski mesajlardaki FAIL widget'ları tarihsel ilk koşu kanıtıdır. |
| Initial widget hydration | PASS (tekrar koşusu) | `window.openai.toolOutput` nested `result.structuredContent` biçimi normalize edildi; host-bridge 6/6 ve real-host yeni çağrısı PASS. |
| Varyant | PASS | M/Siyah stokta, L/Siyah stokta yok olarak gösterildi. |
| Merchant handoff | PASS | `Satın Al` yeni sekmede `https://example.com/products/1?shopai_click_id=...` açtı. Bu gerçek checkout değil, doğru adlandırılmış demo product-page handoff'tur. |
| Görsel yükleme | HOSTED PASS / REAL HOST TEKRAR EKSİK | Açıkça `SENTETİK DEMO · GERÇEK ÜRÜN DEĞİL` etiketli SVG; hosted smoke origin, `image/svg+xml`, CORS ve CORP kontrolünü geçti. Gerçek ChatGPT iframe render kaydı henüz yok. |
| Timeout/hata UX | KISMİ PASS | Detail hatası sonlandı ve yeniden deneme mesajı gösterildi; kontrollü gerçek timeout senaryosu ayrıca çalıştırılmadı. |
| Saved identity | Beklenen sınırlama / account-linking gerekli | Tekrar koşusunda `save_product` kayıt ID'si `2de63147-c23f-42cf-8a3a-694ac95e5d53` üretti; hemen sonraki stateless `list_saved_products` boş döndü. Stateful `Mcp-Session-Id` entegrasyon testi PASS olsa da gerçek host ayrı tool çağrılarında bu session/cookie principal'ını taşımıyor. Davranış kullanıcıya açık raporlandı; TASK-024 gerekir. |
| Alert identity | KISMİ | Salt okunur `list_product_alerts` çalıştı ve boş liste döndü. Yeni e-posta alarmı oluşturulmadı; bildirim aboneliği testi yapılmadı. |
| Profile identity (web ↔ ChatGPT) | FAIL / kanıtsız | MCP bağlantısı `Yetkilendirme Yok`; web cookie/account ile bağlayan bir account-linking akışı yok. |
| CSP | TEKRAR KAYDI EKSİK | Kullanıcı onayıyla `Geliştirici modunda CSP’yi zorunlu kıl` açıldı ve ayar `on` görüldü. Yeni release çağrısı çalıştı; fakat ShopAI-origin console kaydı ve rozet sonucu kalıcı kanıt olarak henüz kaydedilmedi. |
| Console | KISMİ | DevTools 218 host hatası gösterdi; görünen örnekler ChatGPT `tr-TR` eksik çeviri anahtarlarıydı. `widget-fizyoflow` filtresi ShopAI-origin hata eşleştirmedi. CSP rozeti nedeniyle bu sonuç CSP kabulünü geçirmez. |
| Ekran kaydı | EKSİK | Otomasyon oturumu gözlemlendi, fakat kalıcı video kaydı üretilmedi. |

## Kimlik kararı

Mevcut public/no-auth MCP bağlantısı ChatGPT kullanıcısını ShopAI web profilindeki server-issued anonymous cookie ile eşleyemez. Aynı ChatGPT konuşmasındaki ayrı tool çağrıları da `Mcp-Session-Id`/cookie principal'ını taşımadığı için save başarılı yanıtından sonra listede görünmez. Stateful MCP istemcisi için mühendislik testi PASS'tir; gerçek ChatGPT davranışı ise kimliksiz/stateless modda sınırlı olarak belgelenmiştir. TASK-015/016 mühendislik durumu tamamdır, yüzeyler arası dış kabul TASK-024'e bağlıdır; TASK-017 gerçek teslim kabulü ayrıca açıktır.

Takip: `TASK-024 — Web/ChatGPT account linking ve MCP principal sürekliliği` tanımı `docs/follow-ups/task-024-account-linking.md` içinde tutulur.

## Koşu sonrası mühendislik düzeltmeleri

Bu bölüm dış kabul sonucu değildir; değişiklikler yeni bir release ile gerçek hostta tekrar edilene kadar yukarıdaki FAIL sonuçları korunur.

- Widget host köprüsü, MCP Apps hostlarının hem doğrudan hem `result.structuredContent` biçimindeki tool-result zarflarını normalize edecek şekilde düzeltildi. Nested detail çağrısı ve notification biçimi unit testle doğrulandı.
- `/mcp` initialize akışı stateful session üretir ve aynı session boyunca aynı server-issued shopper identity'yi kullanır. Çerez taşımayan gerçekçi `initialize → save_product → list_saved_products → DELETE session` entegrasyon testi PostgreSQL üzerinde geçti.
- Eski stateless MCP istemcileri geriye dönük uyumluluk için çalışmaya devam eder; onlar kimlik sürekliliği garantisi taşımaz.
- `interaction_events` public insert akışında `RETURNING` için gereken session-sınırlı SELECT grant/RLS politikası eklendi. Saved-products entegrasyon dosyasındaki 8 test gerçek DB üzerinde geçti.
- Bu düzeltme yalnız aynı MCP bağlantısındaki sürekliliği sağlar. Web ↔ ChatGPT ortak principal hâlâ OAuth/account-linking gerektirir; TASK-024 kapanmaz.
- Kullanıcı onayıyla gerçek ChatGPT Plus hesabında `Geliştirici modunda CSP’yi zorunlu kıl` ayarı açıldı ve ayar anahtarı `on` olarak doğrulandı. Bu, eski koşunun CSP FAIL sonucunu değiştirmez; yeni release ile widget yeniden render edilerek rozet/console sonucu kaydedilmelidir.

## Kapanış için gerekenler

1. Authenticated MCP principal/account-linking ile web/ChatGPT yüzeyleri ve stateless tool çağrıları arası sürekliliği TASK-024 kapsamında doğrula.
2. Açık developer-mode CSP enforcement ile ShopAI-origin console/CSP sonucunu kalıcı kaydet.
3. Gerçek izinli katalog görselleriyle image-origin yüklemesini doğrula.
4. Kontrollü timeout ve hata senaryosunu çalıştır.
5. Tarih ve release SHA görünür biçimde ekran kaydı üret. macOS `screencapture` denemesi exit 1 döndü; ekran kayıt izni/harici kayıt aracı gerekir.
