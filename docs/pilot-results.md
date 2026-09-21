# ShopAI pilot sonucu ve devam kararı

Son güncelleme: 21 Eylül 2026

Görevlerin mühendislik ve dış kabul durumu için tek kaynak `docs/06-implementation-status.md` dosyasındaki kanonik tablodur. Bu belge yalnız pilot koşularının sonucunu kaydeder; görev kapatmaz.

## Karar özeti

**Mevcut karar: PİLOT YAYININA HAZIR DEĞİL — dış kabul kanıtı bekleniyor.**

Teknik temel, hosted staging ve gerçek ChatGPT Developer Mode koşusu vardır; ancak gerçek host koşusu kısmi başarısızdır. Saved identity sürekliliği, karttan detail, CSP, gerçek görsel ve ekran kaydı eksikleri yanında izinli bağımsız gerçek mağaza/kullanıcı, rollback ve ücretli devam kanıtı yoktur. Bu nedenle ürün faydası veya ücret ödeme isteği hakkında olumlu sonuç çıkarılamaz.

**Onaylanan sonraki adım:** `docs/pilot-brief.md` uyarınca `M01` kodlu, sentetik CSV kataloglu iç kullanılabilirlik koşusu yapılabilir. Önceden sabit eşik 25 görevin en az 20'sinin başarılı olması, kullanıcı başına en az 3/5 başarı, başarılı görevlerde en fazla 90 saniye medyan ve sıfır çıkışsız akıştır; sert beden/fiyat/stok doğruluğu ile yetkisiz erişimde tolerans sıfırdır. M01 sonucu gerçek butik kabulü, pazar talebi, satış artışı veya ödeme isteği kanıtı sayılmaz.

## Çalıştırılmış teknik kanıt

| Alan | Durum | Kanıt / sınırlama |
|---|---|---|
| Format, lint, typecheck, build | Geçti | Güncel doğrulama bu revizyonda yeniden çalıştırılır; görev kanıtları kanonik tabloda dosya bazında kayıtlıdır |
| Temel otomatik testler | Geçti | Test sayısı sabit kanıt olarak kullanılmaz; gerçek pilot verisi içermez |
| PostgreSQL/Redis entegrasyon testleri | Geçti | Tenant, rol, bağlantı, setup yarışı, import/sync, public RLS ve altyapı kapsamı |
| Migration zinciri | Geçti | Temiz veritabanı/CI migration sözleşmesi; production'a otomatik migration uygulanmış değildir |
| WooCommerce simple/variable otomatik regresyonu | Geçti | Variation ID, beden/renk, fiyat/stok ve eksik snapshot güvenliği sahte HTTP + PostgreSQL ile kapsandı |
| TASK-023A sentetik prova | Geçti | PR #39 / `cb74208`; 5 sentetik merchant, 10k+ ürün ve 100 deterministik yolculuk; gerçek katılımcı kabulü değildir |
| Onboarding Playwright senaryosu | Hazır; dış kabul bekliyor | İzinli gerçek merchant credential'ı ve kaydedilmiş hosted koşu gerekli |
| Gerçek WooCommerce kaynak mutabakatı | Bekliyor | İzinli gerçek ürün ve mağaza erişimi gerekli |
| Hosted MCP/widget smoke | Manuel PASS kaydı | `docs/07-chatgpt-staging.md`; exact deployed SHA/run URL bulunmadığı için auditable release acceptance değildir |
| Web varyant/redirect senaryosu | Sentetik/hosted teknik yol geçti; dış kabul bekliyor | İzinli gerçek ürün ve kaynak mutabakatı gerekli |
| MCP ürün eşitliği senaryosu | Otomatik geçti | MCP HTTP/resource yolunu kapsar; gerçek ChatGPT iframe kanıtı değildir |
| Gerçek ChatGPT oturumu | Kısmi / FAIL | 21 Eylül 2026 gerçek Plus + Developer Mode koşusu: search/widget/filter/direct detail/handoff PASS; karttan detail, saved continuity ve CSP FAIL; ekran kaydı eksik. `docs/evidence/task-011b-real-chatgpt-host.md` |
| Backup restore / app rollback | CI restore geçti; gerçek hosted rollback bekliyor | Önceki/yeni SHA ve workflow run URL'si yok |

## Pilot ölçüm tablosu

Pilot tamamlandığında mağaza bazında aşağıdaki tablo gerçek sayılarla doldurulur; `0`, yalnız ölçüm gerçekten etkin ve olay yoksa kullanılır. Entegrasyon yoksa `ölçülmüyor` yazılır.

| Metrik | P01 | P02 | P03 | Tanım |
|---|---:|---:|---:|---|
| İzinli katalog satırı | bekliyor | — | — | Kaynakta kabul edilen satır |
| Yayınlanan ürün/varyant | bekliyor | — | — | Bilinçli yayın onayı |
| Gözlenen kullanıcı/görev | bekliyor | — | — | Moderasyonlu gerçek arama görevi |
| Tekil discovery session | bekliyor | — | — | Merchant ilişkili, rapor aralığında başlayan session |
| Search’e ulaşan session | bekliyor | — | — | Aynı session’da en az bir kullanıcı araması; tekrar arama tek sayılır |
| Detail’e ulaşan session | bekliyor | — | — | Search sonrasında ürün detayı açan tekil session |
| Başarılı görev oranı | bekliyor | — | — | Doğru varyant + doğru yönlendirme / tüm görevler |
| Yanlış ürün | bekliyor | — | — | İstenen ürün niyetine uymayan sonuç |
| Yanlış fiyat | bekliyor | — | — | Kaynak fiyat ile gösterilen fiyat farkı |
| Yanlış beden | bekliyor | — | — | Sert beden koşulu ihlali |
| Yanlış stok | bekliyor | — | — | Eski/bilinmeyen stokun kesin güncel sunulması |
| İnsan yönlendirmesi | bekliyor | — | — | Bot olmayan redirect olayı |
| Handoff’a ulaşan session | bekliyor | — | — | Search → detail → insan yönlendirmesi zincirini tamamlayan tekil session |
| Atfedilen satış | ölçülmüyor/bekliyor | — | — | İmzalı, searchId+offerId taşıyan sipariş |
| Satın almaya ulaşan session | ölçülmüyor/bekliyor | — | — | Zinciri doğrulanmış conversion ile tamamlayan tekil session; entegrasyon yoksa ölçülmüyor |
| Repeat anonymous visitor rate | bekliyor | — | — | En az iki session kimliği / en az bir session kimliği; kişi düzeyi retention değildir |
| Ek satış | ölçülmüyor | — | — | Kontrol grubu olmadan iddia edilmez |
| Aylık işletim maliyeti | bekliyor | — | — | DB+Redis+depo+model+operasyon |
| Ücretli devam isteği | bekliyor | — | — | Evet/hayır, fiyat ve koşul |

`M01` mock koşusunun sonuçları bu tabloya yazılmaz; ayrı koşu kaydında görev bazında tutulur ve yalnız kullanılabilirlik öğrenimi olarak raporlanır.

## Bilinen sınırlamalar ve açık bulgular

- WooCommerce connector basit ve variable ürünleri destekler; gerçek mağazada variation ID/fiyat/stok kaynak mutabakatı henüz yapılmadı.
- Gerçek ChatGPT host koşusu yapılmıştır; search/widget/filter/direct detail/handoff geçti. Karttan detail, saved identity ve CSP başarısız olduğu için kabul açık kalır.
- Hosted staging için manuel smoke kaydı vardır; exact SHA/run URL'li rollback/restore kanıtı yoktur. CI'daki izole restore gerçek hosted rollback yerine geçmez.
- AES-256-GCM yerel secret dosyası şifrelemesi vardır; bu Vault/KMS entegrasyonu, rotation veya erişim audit'i değildir.
- 1.000 satırlık batch import vardır; snapshot'ın tamamı önce bellekte toplandığı için streaming/bounded-memory ingestion değildir.
- Kullanıcı araştırması yapılmadığı için arama kalitesi test seti gerçek görev başarısının yerine geçmez.
- Conversion callback'i olmayan mağazada satış ve dönüşüm oranı “ölçülmüyor” kalır.
- Event adetleri tekil session oranlarından ayrı raporlanır. Tekrar arama/tıklama event adedini artırabilir fakat aynı session'ın funnel payını artırmaz; botlar handoff sayılmaz, iptaller satın alma sayılmaz, iadeler tarihsel satın alma olarak kalıp net geliri düşürür.

## Bekleyen kabul kapıları

| Kapı | Tamamlanma koşulu | Zorunlu kanıt |
|---|---|---|
| Gerçek WooCommerce | Basit ürün, beden/renk varyasyonları, stoksuz varyant, fiyat değişikliği ve yayından kaldırma ShopAI ile kaynakta eşleşir; başarısız okuma mevcut ürünleri pasifleştirmez. | Tarih, release SHA, anonimleştirilmiş kaynak/ShopAI karşılaştırması ve test sorumlusu |
| Staging | TLS readiness doğru SHA'yı verir; giriş, ilk arama, filtreli arama, import ve worker smoke testleri geçer. | Deployment URL/SHA ve workflow run URL'si |
| Gerçek ChatGPT | Widget yüklenir; ilk ve filtreli sonuç görünür; timeout/hata sonlanır; yönlendirme doğru ürüne gider. | Hesap/workspace kodu, tarih, SHA ve ekran/run kanıtı |
| Rollback | Önceki immutable image SHA'sı dağıtılır ve readiness/smoke testleri yeniden geçer. | Önceki/yeni SHA ve rollback workflow URL'si |

## Karar kuralları

**Devam:** Açık kritik/yüksek hata yok; görev başarısı hedefi mağazayla önceden belirlenen eşiği geçiyor; rapor kaynak olaylarla mutabık; en az bir mağaza belirli fiyat/koşulla ücretli devam etmek istiyor.

**Değiştir:** Güvenlik/veri doğruluğu korunuyor fakat kullanıcı görevi veya ödeme isteği zayıf; en büyük yanlış sonuç sınıfı ve iki haftalık tek ürün hipotezi açıkça seçilir.

**Durdur:** Tenant/yetki veya yanlış varyant riski kabul süresinde kapatılamıyor; mağazalar veri kullanımını onaylamıyor; ya da doğrulanmış fayda maliyeti karşılamıyor.

## Sonraki karar toplantısı

- Sorumlu: atanmadı
- Tarih: atanmadı
- Gerekli girdiler: en az bir tamamlanmış pilot checklist'i, E2E run URL'si, gerçek ChatGPT ekran kaydı, olay mutabakatı, maliyet özeti ve mağaza ücretli devam yanıtı
- İmzalı karar: bekliyor
# Pilot ölçüm tanımları

Mağaza raporu ilk sayfa arama denemelerini, sonuç bulunamayan başarılı
aramaları ve teknik olarak başarısız aramaları ayrı gösterir. Boş sonuç oranı
`boş başarılı arama / başarılı ilk arama`; hata oranı `hatalı ilk arama / tüm
ilk arama denemeleri` olarak hesaplanır. Sonraki sayfa istekleri bu paydalara
katılmaz ve ayrıca raporlanır. Sabit bir işlem kimliği bulunmadığından web veya
MCP/ChatGPT istemcisinin tekrar gönderdiği çağrı yeni deneme sayılır.

`web` kanalı web araması ve mağazaya özel paylaşım sayfasını; `mcp` kanalı
ChatGPT hostunun `search_products` tool çağrılarını kapsar. Mağazaya
atanamayan global boş aramalar mağaza raporuna yazılmaz. Raporlama için ham
kullanıcı sorgusu saklanmaz; yalnız mağaza, kanal, ilk sayfa/sayfalama, sonuç
durumu, arama kimliği ve zaman tutulur.

Bot önizlemeleri insan yönlendirmesi veya dönüşüm paydasına girmez. İmzalı
satış callback'i yapılandırılmamışsa satış, gelir ve dönüşüm ölçülmüyor olarak
kalır. Kontrol grubu olmadığı sürece ek satış veya yeni müşteri iddiası
yapılmaz.
