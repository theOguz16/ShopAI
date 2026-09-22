# Uygulama ve kabul durumu — 21 Eylül 2026

Bu dosya TASK-001–023B ve takip görevleri için **tek kanonik durum tablosudur**. Mimari belgeler hedefi, bu tablo ise kanıtlanmış mevcut durumu gösterir. Bir PR'ın merge edilmiş olması mühendislik uygulamasını; gerçek mağaza, kullanıcı, hosted ortam veya hukuki onay gerektiren dış kabulü tek başına kanıtlamaz.

## ÜRÜN-001 — tek kapsam ve görev kimliği

Bu bölüm eski pilot adlarını yeni ürün kapsamıyla eşler. Aynı kabul kanıtı birden fazla görevi tamamlamış sayılmaz; her satır kendi kapsamı ve kanıtıyla kapanır.

### İlk sürüm sınırı

- Dil: Türkçe. Para birimi: TRY. Ürün: fiziksel ürün.
- WooCommerce: `simple` ve `variable` ürünler.
- Shopify: standart ürün ve standart varyant.
- Trendyol ve Hepsiburada: **erişim bekliyor; bu sürümün yayın engeli değil**.
- Kapsam dışı: abonelik ürünü, bundle/kit, kişiye özel fiyat ve karmaşık ürün oluşturucular.

WooCommerce teknik kabulü ayrı tutulur. Sentetik/staging veya VDS read-only kanıtı teknik kabuldür; gerçek mağaza kabulü ve gerçek satış kabulü değildir. Gerçek merchant/user pilotu TASK-023B'dir.

### Eski iş adları → kanonik görevler

| Eski ad / referans | Tek kanonik kimlik | Kapsam, bağımlılık ve tamamlanma kanıtı |
|---|---|---|
| S07 / TASK-011B hosted ChatGPT pilotu | TASK-011B | Gerçek host, widget ve hosted operasyon kanıtı; görsel alt kapısı TASK-025, kimlik sürekliliği TASK-024. Exact release/run, console/CSP ve ekran kaydı gerekir. |
| “TASK-024 görsel kabul” / v4 iframe kabulü | **TASK-025 — gerçek-host görsel kabulü** | v4 iframe, kontrollü timeout, ShopAI-origin console/CSP ve ekran kaydı; `docs/follow-ups/task-025-visual-acceptance.md`. |
| TASK-024 account-linking takip işi | **TASK-024 — Web/ChatGPT account linking** | OAuth/bağlı principal, web ↔ ChatGPT save/list ve alert sürekliliği; `docs/follow-ups/task-024-account-linking.md` kabul maddeleri. |
| S09 / TASK-018 teknik WooCommerce pilotu | TASK-018 + TASK-018C | WooCommerce simple/variable teknik sync; `docs/evidence/task-018c-woocommerce-staging-acceptance.md`. Gerçek merchant sonucu değildir. |
| “Gerçek WooCommerce mağazası” | TASK-018B | İzinli gerçek mağaza, kaynak–ShopAI mutabakatı ve public HTTPS; staging kanıtına ek dış kabul. |
| S10 / checkout ve satış | TASK-012 + TASK-013 + TASK-023B | Redirect/callback mühendisliği ayrı; gerçek checkout, sipariş ve conversion kanıtı ayrı. |
| S11 / yayın ve operasyon | TASK-021 | Production readiness, rollback, alert, secret ve legal kanıtları `docs/production-readiness.md` içindedir. |
| TASK-019/020 Trendyol | TASK-019 + TASK-020 | Teknik connector/onboarding mevcut; gerçek seller erişimi bekliyor, yayın engeli değil. |
| Hepsiburada erişimi | Yeni görev açılmadı | Bu sürümde erişim bekliyor; kapsamı ve yayın kabulü yok. Erişim gelirse ayrı kimlik açılır. |

### #53 değerlendirmesi

Yerel görev ve kanıt belgelerinde `#53` için mevcut VDS kabulüne ek zorunlu bir kabul maddesi, yeni metrik veya yeni yayın kapısı bulunmuyor. Mevcut VDS kanıtı zaten aktif WooCommerce bağlantısı, merchant kapsamı, ürün/varyant/offer sayıları, DB/API/dashboard mutabakatı ve read-only SQL yöntemini kapsıyor (`docs/evidence/task-018c-woocommerce-staging-acceptance.md`). Bu nedenle #53 ana dala körlemesine eklenmemiştir; yeni gereksinim belgelenirse ayrı kimlik ve bağımlılık olarak kaydedilmelidir.

Durumlar:

- **Tamamlandı:** kapsam kod ve otomatik test kanıtıyla karşılanıyor.
- **Kısmi:** çalışan bir alt kapsam var, fakat görevin/issue'nun bütün kabul maddeleri karşılanmıyor.
- **Bekliyor:** gerekli dış ortam, kişi veya işletme kanıtı yok.
- **Gerekmez:** görev için ayrı bir dış kabul kapısı tanımlı değil.

## Kanonik görev tablosu

| Görev | Mühendislik durumu | Dış kabul durumu | İlgili PR / merge SHA | Test / kabul kanıtı | Kalan somut engel |
|---|---|---|---|---|---|
| TASK-001 — surface/transport ayrımı | Tamamlandı | Gerekmez | [PR #1](https://github.com/theOguz16/ShopAI/pull/1) · `a0d998e` | `tests/integration/analytics.test.ts`, REST/MCP surface attribution | Yok |
| TASK-002 — discovery session | Tamamlandı | Gerekmez | [PR #2](https://github.com/theOguz16/ShopAI/pull/2) · `917ef57` | `tests/integration/discovery-session.test.ts` | Yok |
| TASK-003 — branded storefront | Tamamlandı | Gerekmez | [PR #5](https://github.com/theOguz16/ShopAI/pull/5) · `e35f8b9`; [PR #42](https://github.com/theOguz16/ShopAI/pull/42) · `023f1a2` | `tests/integration/storefront.test.ts`, `tests/integration/discovery-session.test.ts`; bounded campaign doğrulaması ve session aktarımı | Yok; [issue #6](https://github.com/theOguz16/ShopAI/issues/6) kanıtla kapatıldı |
| TASK-004 — merchant onboarding | Tamamlandı | Gerçek credential akışı bekliyor | [PR #8](https://github.com/theOguz16/ShopAI/pull/8) · `e3e00e4` | `tests/integration/onboarding.test.ts`, tenant/rol ve eşzamanlı setup testleri | İzinli gerçek merchant credential'ı ile kabul; production secret-manager kapsamı ayrıca #9 |
| TASK-005 — first catalog import UX | Tamamlandı | Gerçek büyük katalog kabulü bekliyor | [PR #10](https://github.com/theOguz16/ShopAI/pull/10) · `514b104`; [PR #42](https://github.com/theOguz16/ShopAI/pull/42) · `023f1a2` | `tests/catalog-sync-progress.test.ts`, `tests/task019-catalog-scale.test.ts`, `tests/integration/sync-retry-consistency.test.ts`: sayaç yalnız commit edilmiş batch'leri izler, baştan retry idempotenttir | Streaming değildir: tüm `SourceRow[]` bellekte toplanır; #11 ve #12 açık |
| TASK-006 — catalog health | Tamamlandı | Gerekmez | [PR #13](https://github.com/theOguz16/ShopAI/pull/13) · `50b45f7` | Unit: `tests/catalog-health.test.ts`; PostgreSQL/Redis CI: `tests/integration/catalog-health.test.ts` | Yok |
| TASK-007 — public discovery API | Tamamlandı | Gerekmez | [PR #14](https://github.com/theOguz16/ShopAI/pull/14) · `025e8b8` | `tests/integration/api.test.ts`, REST/MCP parity | Yok |
| TASK-008 — category/facet MVP | Tamamlandı | Gerekmez | [PR #15](https://github.com/theOguz16/ShopAI/pull/15) · `ac4c273` | Unit: `tests/category-facets.test.ts`; PostgreSQL/Redis CI: `tests/integration/category-facets.test.ts` | MVP yalnız sürümlü pilot kategorilerini kapsar; generic ontology hedef değildir |
| TASK-009 — product detail | Tamamlandı | Gerçek katalog görsel/varyant QA bekliyor | [PR #16](https://github.com/theOguz16/ShopAI/pull/16) · `757a8ba`; [PR #42](https://github.com/theOguz16/ShopAI/pull/42) · `023f1a2` | `tests/integration/product-detail-api.test.ts`, `tests/integration/discovery-session.test.ts`; doğrudan detail arama olayı üretmez, zincir attribution'ı korunur | Gerçek merchant görselleri ve ChatGPT iframe görsel QA; [issue #17](https://github.com/theOguz16/ShopAI/issues/17) kanıtla kapatıldı |
| TASK-010 — shopping widget | Tamamlandı | Gerçek ChatGPT host kabulü kısmi | [PR #18](https://github.com/theOguz16/ShopAI/pull/18) · `3e1b14d`; [PR #43](https://github.com/theOguz16/ShopAI/pull/43) · `c4cebb9`; [PR #47](https://github.com/theOguz16/ShopAI/pull/47) · `af1646a`; [PR #50](https://github.com/theOguz16/ShopAI/pull/50) · `a8594cf` | Initial ve notification tool-output zarfları normalize edilir; host-bridge 6/6; real-host search/detail PASS; v4 metadata gerçek hostta aktif; sentetik kabul görseli exact-SHA hosted testte PASS | v4 görselinin gerçek ChatGPT iframe tekrar koşusu, kontrollü timeout, ekran kaydı ve ShopAI-origin console/CSP kaydı; [issue #41](https://github.com/theOguz16/ShopAI/issues/41) |
| TASK-011 — hosted staging | Tamamlandı | Kısmi | [PR #20](https://github.com/theOguz16/ShopAI/pull/20) · `788f23b`; deployed `a8594cfcb739932a2fcaec94fad27b545d3724c1` | Exact-SHA readiness, migration ve hosted smoke PASS; [staging run](https://github.com/theOguz16/ShopAI/actions/runs/35641244699); gerçek ChatGPT search/detail/save/list koşusu: `docs/evidence/task-011b-real-chatgpt-host.md` | TASK-011B: yetkisiz ChatGPT çağrılarında saved principal sürekliliği yok (TASK-024); gerçek-host v4 görsel/timeout, console/CSP ve ekran kaydı eksik (TASK-025) |
| TASK-012 — checkout attribution | Tamamlandı | Gerçek checkout kabulü bekliyor | [PR #21](https://github.com/theOguz16/ShopAI/pull/21) · `1d95c7b` | redirect/analytics entegrasyon testleri; private merchant DB kapısı ayrıca `0025_public_visibility_rls.sql` | Gerçek merchant checkout ve canlı olay mutabakatı |
| TASK-013 — conversion callback | Tamamlandı | Merchant callback kabulü bekliyor | [PR #23](https://github.com/theOguz16/ShopAI/pull/23) · `93e2058` | imza, idempotency, paid/refunded/cancelled testleri | En az bir gerçek merchant callback kurulumu ve kaynak sipariş mutabakatı |
| TASK-014 — merchant analytics | Tamamlandı | Pilot metrik mutabakatı bekliyor | [PR #24](https://github.com/theOguz16/ShopAI/pull/24) · `e1cd70e` | `tests/integration/merchant-analytics-dashboard.test.ts` | Gerçek pilotta kaynak olay/sipariş mutabakatı; kontrol grubu olmadan ek satış iddiası yapılamaz |
| TASK-015 — anonymous shopping profile | Tamamlandı | Web/ChatGPT süreklilik kabulü başarısız | [PR #25](https://github.com/theOguz16/ShopAI/pull/25) · `7e8072c` | Otomatik cookie/spoof testleri; gerçek host bulgusu `docs/evidence/task-011b-real-chatgpt-host.md` | Yetkilendirmesiz MCP principal web anonymous cookie ile eşleşmiyor; TASK-024 account linking gerekli |
| TASK-016 — saved products | Tamamlandı | Yetkisiz gerçek ChatGPT hostta kimlik sürekliliği yok | [PR #26](https://github.com/theOguz16/ShopAI/pull/26) · `4752b27`; [PR #42](https://github.com/theOguz16/ShopAI/pull/42) · `023f1a2` | Stateful MCP session save → list DB entegrasyon testi PASS; gerçek ChatGPT save ID üretip sonraki list çağrısında boş principal gördü | ChatGPT ayrı stateless tool çağrılarında cookie veya `Mcp-Session-Id` taşımıyor; web ↔ ChatGPT ve çağrılar arası principal için TASK-024 OAuth/account linking |
| TASK-017 — price/stock alerts | Tamamlandı | Gerçek bildirim teslimi bekliyor | [PR #27](https://github.com/theOguz16/ShopAI/pull/27) · `c6ec318` | `tests/integration/product-alerts.test.ts` | Gerçek provider/recipient ile teslim, unsubscribe ve operasyon kabulü |
| TASK-018 — technical pilot | Tamamlandı (sentetik staging teknik kabulü) | Tamamlandı | [PR #31](https://github.com/theOguz16/ShopAI/pull/31) · `d959320`; [PR #55](https://github.com/theOguz16/ShopAI/pull/55) · deployed `3cf084a` | 520 ürün, 300 native Woo variation, 720 normalize variant; kaynak → DB/API → oturumlu dashboard mutabakatı; Test Urunu 78 tek ürün incremental görsel düzeltmesi | Gerçek merchant/user kabulü TASK-018 kapsamında tamamlanmış sayılmaz; ayrı TASK-023B açık kalır |
| TASK-019 — Trendyol Product V2 connector | Tamamlandı | Gerçek Trendyol hesabı kabulü bekliyor | [PR #32](https://github.com/theOguz16/ShopAI/pull/32) · `41173d6` | connector testleri; `tests/task019-catalog-scale.test.ts` 101 sayfa/10.100 satır | Yetkili gerçek seller/test hesabı ve kaynak mutabakatı |
| TASK-020 — Trendyol onboarding | Tamamlandı | Gerçek Trendyol onboarding kabulü bekliyor | [PR #33](https://github.com/theOguz16/ShopAI/pull/33) · `7854ad6` | onboarding/connector entegrasyon testleri | Yetkili gerçek seller/test hesabı |
| TASK-021 — production readiness | Tamamlandı (otomasyon) | Bekliyor | [PR #34](https://github.com/theOguz16/ShopAI/pull/34) `187ca8c`; [PR #35](https://github.com/theOguz16/ShopAI/pull/35) `62f55e3` | env/secret/alert/deploy sözleşme testleri, CI backup+isolated restore | Gerçek production environment/host, alert receiver, exact-SHA staging/deploy/rollback run URL'leri ve legal sign-off; bkz. `docs/production-readiness.md` |
| TASK-022 — pilot metric taxonomy | Tamamlandı | Gerçek pilot veri mutabakatı bekliyor | [PR #36](https://github.com/theOguz16/ShopAI/pull/36) · `db40c1e`; [PR #42](https://github.com/theOguz16/ShopAI/pull/42) · `023f1a2` | PostgreSQL/Redis CI'da `search-analytics-intent`, interaction events ve kontrollü session funnel testleri çalışır; `docs/pilot-metrics.md` | Gerçek pilot olayları ve merchant kaynaklarıyla mutabakat |
| TASK-023A — synthetic pilot rehearsal | Tamamlandı | Gerekmez; gerçek kabul sayılmaz | [PR #39](https://github.com/theOguz16/ShopAI/pull/39) · `cb74208`; [PR #42](https://github.com/theOguz16/ShopAI/pull/42) · `023f1a2` | Outcome-derived oranlar, non-zero empty/error fixture'ları, fail-closed recovery, makine-okur setup FAIL ve CI artifact; [CI run](https://github.com/theOguz16/ShopAI/actions/runs/35601051437) | Yok; [issue #40](https://github.com/theOguz16/ShopAI/issues/40) kanıtla kapatıldı. Bu kanıt TASK-023B değildir |
| TASK-023B — real merchant/user pilot | Mühendislik altyapısı hazır; görev kabulü bekliyor | Bekliyor | [issue #38](https://github.com/theOguz16/ShopAI/issues/38) · PR/SHA yok | Henüz gerçek katılımcı kanıtı yok; sentetik TASK-023A bu satırı karşılamaz | 3–5 bağımsız merchant, desteklenen provider kabulü, 100+ gerçek oturum, gerçek checkout/conversion ve geri bildirim/operasyon kaydı |

## Issue denetimi (#3, #4, #9, #11, #12, #22)

| Issue | Kodla karşılaştırma | Karar / kanıt |
|---|---|---|
| [#3 — PostgreSQL 17 `pg_dump`](https://github.com/theOguz16/ShopAI/issues/3) | Bütünüyle karşılandı; kapatıldı | `.github/workflows/ci.yml` PostgreSQL 17 client kuruyor; `infra/backup.sh` ve izole restore aynı integration job'da çalışıyor. Main CI `cb74208` PASS. |
| [#4 — server-issued anonymous identity](https://github.com/theOguz16/ShopAI/issues/4) | Bütünüyle karşılandı; kapatıldı | `apps/api/src/plugins/anonymous-user.ts` server-issued HttpOnly/SameSite cookie üretir; spoof testi istemci UUID'sini reddeder. Main CI `cb74208` PASS. |
| [#9 — Vault/KMS secret storage](https://github.com/theOguz16/ShopAI/issues/9) | Kısmi; açık kalmalı | `packages/connectors/src/managed-secrets.ts` yerel dosyada AES-256-GCM sağlar ve production key'siz fail eder. Vault/KMS/managed provider, rotation, erişim audit'i ve plaintext migration/safe deletion planı yoktur. **AES şifreleme Vault/KMS entegrasyonu değildir.** |
| [#11 — sabit katalog sayfa tavanı](https://github.com/theOguz16/ShopAI/issues/11) | Kısmi; açık kalmalı | 100 sayfalık eski sınır 10.000'e yükseldi ve 101 sayfa testi geçiyor; fakat `maxPages`/`maxRows` yapılandırılabilir değil ve limit-exceeded sözleşmesi acceptance ile aynı değil. |
| [#12 — chunk/stream büyük katalog](https://github.com/theOguz16/ShopAI/issues/12) | Kısmi; açık kalmalı | Import 1.000 satırlık batch'lere ayrılıyor; buna rağmen `collectCatalogSnapshot()` önce bütün `SourceRow[]` dizisini bellekte topluyor. **Batch import streaming değildir**; bounded-memory staging, chunk-boundary idempotency/recovery yoktur. |
| [#22 — public RLS ve `is_public`](https://github.com/theOguz16/ShopAI/issues/22) | Bütünüyle karşılandı; kapatıldı | `0025_public_visibility_rls.sql` consumer-facing public policy/helper'ları `active AND is_public` ile hizalar; migration ve PostgreSQL tenant-isolation testleri private merchant erişimini reddeder. Main CI `cb74208` PASS. |

## Geçerli sınırlar ve dış kabul kapıları

- Connector secret dosyaları production/staging anahtarıyla AES-256-GCM encrypted-at-rest tutulur. Bu uygulama-içi dosya şifrelemesidir; Vault/KMS, rotation ve auditable secret lifecycle değildir.
- WooCommerce/Trendyol katalog sayfaları tamamı bellekte biriktirildikten sonra 1.000 satırlık import batch'lerine ayrılır. Bu, streaming veya bounded-memory ingestion değildir.
- Hosted staging exact deployed SHA ve workflow URL'siyle doğrulanmıştır; bu teknik smoke gerçek ChatGPT iframe, gerçek merchant, rollback veya hukuki kabulün yerine geçmez.
- Teknik/sentetik kanıtlar gerçek merchant, gerçek kullanıcı, gerçek ChatGPT iframe, canlı conversion, rollback veya hukuki kabulün yerine geçmez.
- TASK-021 ancak `docs/production-readiness.md` içindeki operatör ve legal kapılar da gerçek kanıtlarla tamamlandığında dış kabulden geçmiş sayılır.

## Güncelleme kuralı

Sonraki her görev veya follow-up PR'ı bu tabloyu aynı değişiklik setinde günceller. `Tamamlandı` satırı için PR/SHA ve çalıştırılmış test/kanıt; `Bekliyor` veya `Kısmi` satırı için de tek cümlelik somut eksik zorunludur. Pilot ve staging belgeleri görev durumunu yeniden tanımlamaz; bu dosyaya bağlanır ve yalnız kendi koşu kanıtını taşır.

## Revizyon kanıtları

| Revizyon | Durum | Kanıt | Kalan engel |
|---|---|---|---|
| TASK-011B — gerçek ChatGPT host kabulü | Kısmi; açık | Gerçek Plus + Developer Mode hesabında search, widget hydration, detail/varyant ve alert-list PASS; v4 metadata yenilemesi gerçek hostta doğrulandı. Deployed `a8594cfcb739932a2fcaec94fad27b545d3724c1` için hosted smoke, sentetik kabul görseli ve exact-SHA [workflow kaydı](https://github.com/theOguz16/ShopAI/actions/runs/35641244699) PASS. Saved çağrısı stateless sonraki çağrıda farklı anonymous principal nedeniyle listede görünmüyor; TASK-024 belgeli. | v4 görselinin gerçek ChatGPT iframe tekrar koşusu, kontrollü timeout, ShopAI-origin console/CSP kaydı ve ekran kaydı (TASK-025). Web ↔ ChatGPT ve stateless çağrılar arası principal için TASK-024. |
| TASK-018B — bağımsız WooCommerce mağaza kabulü | Kısmi; açık | Kullanıcının `giyimeticaret` LocalWP mağazası 98 mevcut + 520 sentetik kabul ürünüyle 618 published ürüne çıkarıldı. Variable/indirim/stoksuz/eksik veri kaynakta doğrulandı; `docs/evidence/task-018b-localwp-acceptance.md`. | URL'ler `.local`; Cloudflare quick tunnel üç kez timeout verdi. Public HTTPS olmadan staging sync, kaynak–ShopAI mutabakatı, gerçek ChatGPT handoff ve merchant analytics çalıştırılamadı. Satış ölçülmüyor. |
| REV-002 — CI DB test kapsamı | Tamamlandı | [PR #42](https://github.com/theOguz16/ShopAI/pull/42) · `023f1a2`; [CI run](https://github.com/theOguz16/ShopAI/actions/runs/35601051437). Envanter 31 unit ve 24 integration dosyasını dizin kuralıyla otomatik eşler. PostgreSQL 17 + Redis 7: migration PASS, 24/24 dosya ve 131/131 integration test PASS; catalog-health, category-facets ve search-analytics-intent logda ayrı çalışır. Aynı committe `pnpm check` PASS. | Yok |
| REV-003 — sync progress ve retry doğruluğu | Tamamlandı | [PR #42](https://github.com/theOguz16/ShopAI/pull/42) · `023f1a2`. Kontrollü ikinci-batch hatası riski önce testte doğrulandı; düzeltme sonrası `partial=1000/1200`, retry baştan (`cursor=null`), final `1200/1200`, çoğalma yok ve eksik full sync eski offer'ı pasifleştirmiyor. 24/24 integration PASS. | Yok |
| REV-004 — yönlendirme ve attribution anlamları | Tamamlandı | [PR #42](https://github.com/theOguz16/ShopAI/pull/42) · `023f1a2`. Dashboard handoff adları ayrıştırıldı; eski alanlar additive alias olarak korunur. Doğrudan detail arama olayı üretmez; search → detail → benzer detail → handoff session+campaign zinciri testlidir. #6 ve #17 kapatıldı. | Yok |
| REV-005 — TASK-022 event kapsamı | Tamamlandı | [PR #42](https://github.com/theOguz16/ShopAI/pull/42) · `023f1a2`. Append-only interaction events; web+widget category/filter/impression; authoritative save/alert tarihi; attribution, dedup, minimization/retention ve rate limit testleri. 24/24 integration PASS. | Gerçek pilot veri mutabakatı TASK-022 dış kabul kapısıdır |
| REV-006 — session bazlı pilot funnel | Tamamlandı | [PR #42](https://github.com/theOguz16/ShopAI/pull/42) · `023f1a2`. Kontrollü 6-session veri setinde event adetleri/tekil funnel, tekrarlar, bot, iptal/iade, pencere ve repeat identity paydaları birebir; conversion yoksa oran ölçülmüyor. 24/24 integration PASS. | Gerçek pilot session/conversion mutabakatı TASK-022/TASK-023B dış kabul kapısıdır |
| REV-007 — sentetik pilot raporu ve recovery | Tamamlandı | [PR #42](https://github.com/theOguz16/ShopAI/pull/42) · `023f1a2`; [CI run](https://github.com/theOguz16/ShopAI/actions/runs/35601051437). Persisted outcome oranları, non-zero empty/error senaryoları, makine-okur setup FAIL, güvenli recovery marker'ı, MCP/attribution ayrımı ve CI artifact PASS. #40 kapatıldı. | Yok; sentetik sonuç gerçek pilot kabulü değildir |
| REV-008 — WooCommerce staging kabul sertleştirmesi | Tamamlandı | [PR #55](https://github.com/theOguz16/ShopAI/pull/55); deployed `3cf084a`; `docs/evidence/task-018c-woocommerce-staging-acceptance.md`. CI, exact-release smoke, aktif connection DB sayımı, authenticated API ve oturumlu dashboard PASS. | Yok; gerçek merchant/user pilotu ayrı TASK-023B kapsamıdır |
| ÜRÜN-002 — TASK-023A determinism | Tamamlandı; commit CI kanıtı merge koşusunda üretilecek | #54 FAIL/PASS rapor karşılaştırması, sınırlı regresyon testi ve aynı kaynak durumunda iki temiz tam koşu: `docs/evidence/task-023a-determinism.md`. Fixture sonrası explicit `ANALYZE`; MCP transport probu stok tazeliği kabulünden ayrıldı. | CI aynı commit üzerinde iki raporu ayrı artifact dizinlerinde saklar; bu iş TASK-023B gerçek pilot kabulü değildir |
