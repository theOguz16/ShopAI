# TASK-011B — Gerçek ChatGPT host kabul kaydı

Tarih: 21 Eylül 2026 (Europe/Istanbul)

## Sonuç

**KISMİ / KAPI AÇIK.** Yetkili gerçek ChatGPT Plus hesabında Developer Mode ile ShopAI özel uygulaması oluşturuldu ve bağlandı. Arama, gerçek ChatGPT iframe/widget render, renk filtresi, doğrudan ürün detayı, varyant/stok görünümü ve merchant handoff çalıştı. Görev kapatılamaz: widget içi sonuçtan detay açma hata verdi, saved kimliği aynı sohbet içinde korunmadı, CSP hostta kapalıydı, gerçek katalog görselleri yoktu ve ekran kaydı alınmadı.

## Release ve host kanıtı

- Staging readiness: `https://shop.fizyoflow.com/health/ready`
- Readiness sonucu: `status=ok`, `release=cb74208776afb998139ac4211a2477bea543068b`
- Test edilen MCP: `https://shop.fizyoflow.com/mcp`
- UI resource: `ui://widget/shopai-shopping-v3.html`
- ChatGPT uygulama kimliği: `asdk_app_6ab0ce99252081919ba9f97a7a0b1aaf`
- ChatGPT uygulama sürüm kimliği: `asdk_app_v_6ab0ce99252c81918b4c2955f8f7e9f8`
- ChatGPT konuşması: `https://chatgpt.com/c/6ab0cf3a-3f44-83ed-a36f-2feac5da1fdc`
- Hesap sınıfı: gerçek ChatGPT Plus hesabı; kişisel hesap ayrıntıları bu belgeye yazılmadı.

Readiness SHA'sı mevcut repository HEAD ile aynıydı. Ancak çalışma ağacındaki REV-001–007 değişiklikleri commit edilmemiş ve bu staging release'ine dahil değildir.

## Senaryo sonuçları

| Senaryo | Sonuç | Gözlem |
|---|---|---|
| Developer Mode / private app | PASS | ShopAI oluşturuldu; ChatGPT `Success: ShopAI şimdi bağlandı` gösterdi. |
| Tool keşfi | PASS | 8 eylem ve `ui://widget/shopai-shopping-v3.html` şablonu gerçek hostta listelendi. |
| Arama | PASS | `search_products` çalıştı; 3 sentetik ürün döndü. |
| Widget render | PASS | Gerçek ChatGPT sandbox iframe'i render edildi. |
| Filtreleme | PASS | Siyah filtresi 3 ürünü 1 ürüne indirdi. |
| Sonuç kartından detay | FAIL | `İncele` sonrası `Ürün detayı yüklenemedi. Aramaya dönüp yeniden deneyin.` |
| Doğrudan detail tool çağrısı | KISMİ PASS | Detay, M/L varyantları ve stok durumu göründü; widget ayrıca `Ürün verisi bu widget sürümüyle uyumlu değil` uyarısı verdi. |
| Varyant | PASS | M/Siyah stokta, L/Siyah stokta yok olarak gösterildi. |
| Merchant handoff | PASS | `Satın Al` yeni sekmede `https://example.com/products/1?shopai_click_id=...` açtı. Bu gerçek checkout değil, doğru adlandırılmış demo product-page handoff'tur. |
| Görsel yükleme | BLOKE | Katalog ürünlerinde görsel yoktu; kartlar `Ürün görseli yok` gösterdi. Gerçek image-origin kabulü yapılamadı. |
| Timeout/hata UX | KISMİ PASS | Detail hatası sonlandı ve yeniden deneme mesajı gösterildi; kontrollü gerçek timeout senaryosu ayrıca çalıştırılmadı. |
| Saved identity | FAIL | `save_product` başarı döndürdü; aynı konuşmadaki iki `list_saved_products` çağrısı boş döndü. Kalıcılık/süreklilik kanıtlanmadı. |
| Alert identity | KISMİ | Salt okunur `list_product_alerts` çalıştı ve boş liste döndü. Yeni e-posta alarmı oluşturulmadı; bildirim aboneliği testi yapılmadı. |
| Profile identity (web ↔ ChatGPT) | FAIL / kanıtsız | MCP bağlantısı `Yetkilendirme Yok`; web cookie/account ile bağlayan bir account-linking akışı yok. |
| CSP | FAIL | Her widget üzerinde ChatGPT `CSP kapalı` rozeti gösterdi. Manifestte CSP metadata bulunsa da developer-mode enforcement kapalıydı. |
| Console | KISMİ | DevTools 218 host hatası gösterdi; görünen örnekler ChatGPT `tr-TR` eksik çeviri anahtarlarıydı. `widget-fizyoflow` filtresi ShopAI-origin hata eşleştirmedi. CSP rozeti nedeniyle bu sonuç CSP kabulünü geçirmez. |
| Ekran kaydı | EKSİK | Otomasyon oturumu gözlemlendi, fakat kalıcı video kaydı üretilmedi. |

## Kimlik kararı

Mevcut public/no-auth MCP bağlantısı ChatGPT kullanıcısını ShopAI web profilindeki server-issued anonymous cookie ile eşleyemez. Üstelik aynı ChatGPT konuşmasında save başarılı yanıtından sonra listede görünmemiştir. Bu nedenle profile/saved/alert identity continuity kabulü **başarısızdır**; TASK-015/016/017 ve TASK-011B dış kabulü açık kalır.

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

1. Widget detail zarfı düzeltmesini deploy et; sonuç kartından detail ve doğrudan detail'i aynı release'te tekrar çalıştır.
2. Stateful MCP session düzeltmesini deploy et; aynı bağlantıda save → list ve alert → list sürekliliğini tekrar doğrula.
3. Authenticated MCP principal/account-linking ile web/ChatGPT yüzeyleri arası sürekliliği doğrula.
4. Artık açık olan developer-mode CSP enforcement ile yeni release'i test et; ShopAI-origin console/CSP hatası olmadığını kaydet.
5. Gerçek izinli katalog görselleriyle image-origin yüklemesini doğrula.
6. Kontrollü timeout ve hata senaryosunu çalıştır.
7. Tarih ve release SHA görünür biçimde ekran kaydı üret.
