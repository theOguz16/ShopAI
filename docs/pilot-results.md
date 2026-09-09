# ShopAI pilot sonucu ve devam kararı

Son güncelleme: 9 Eylül 2026

## Karar özeti

**Mevcut karar: PİLOT YAYININA HAZIR DEĞİL — dış kabul kanıtı bekleniyor.**

Teknik temel ve otomatik regresyonlar hazırdır; ancak izinli gerçek mağaza, gerçek kullanıcı gözlemi, gerçek ChatGPT oturumu, staging backup/rollback koşusu ve ücretli devam görüşmesi henüz sağlanmadı. Bu nedenle ürün faydası veya ücret ödeme isteği hakkında olumlu sonuç çıkarılamaz. Bu bir ürün başarısızlığı kararı değil, kanıt eksikliği nedeniyle yayın kapısıdır.

**Onaylanan sonraki adım:** `docs/pilot-brief.md` uyarınca `M01` kodlu, sentetik CSV kataloglu iç kullanılabilirlik koşusu yapılabilir. Önceden sabit eşik 25 görevin en az 20'sinin başarılı olması, kullanıcı başına en az 3/5 başarı, başarılı görevlerde en fazla 90 saniye medyan ve sıfır çıkışsız akıştır; sert beden/fiyat/stok doğruluğu ile yetkisiz erişimde tolerans sıfırdır. M01 sonucu gerçek butik kabulü, pazar talebi, satış artışı veya ödeme isteği kanıtı sayılmaz.

## Çalıştırılmış teknik kanıt

| Alan | Durum | Kanıt / sınırlama |
|---|---|---|
| Format, lint, typecheck, build | Geçti | Temiz doğrulama; 9 Eylül 2026 |
| Temel otomatik testler | Geçti | 59 test; gerçek pilot verisi içermez |
| PostgreSQL/Redis entegrasyon testleri | Geçti | 32 test; tenant, rol, bağlantı, setup yarışı, import/sync ve altyapı kapsamı |
| Migration zinciri | Geçti | Temiz veritabanına uygulama tamamlandı |
| WooCommerce simple/variable otomatik regresyonu | Geçti | Variation ID, beden/renk, fiyat/stok ve eksik snapshot güvenliği sahte HTTP + PostgreSQL ile kapsandı |
| Onboarding Playwright senaryosu | Hazır, çalıştırılmadı | Staging pilot erişimleri gerekli |
| Gerçek WooCommerce kaynak mutabakatı | Bekliyor | İzinli gerçek ürün ve mağaza erişimi gerekli |
| Web varyant/redirect senaryosu | Hazır, çalıştırılmadı | TLS staging ve izinli gerçek ürün gerekli |
| MCP ürün eşitliği senaryosu | Hazır, çalıştırılmadı | MCP HTTP'yi kapsar; gerçek ChatGPT UI kanıtı değildir |
| Gerçek ChatGPT oturumu | Bekliyor | Hesap/workspace ve staging host verilmedi |
| Backup restore / app rollback | CI/workflow hazır, gerçek staging kanıtı bekliyor | Workflow run URL'si yok |

## Pilot ölçüm tablosu

Pilot tamamlandığında mağaza bazında aşağıdaki tablo gerçek sayılarla doldurulur; `0`, yalnız ölçüm gerçekten etkin ve olay yoksa kullanılır. Entegrasyon yoksa `ölçülmüyor` yazılır.

| Metrik | P01 | P02 | P03 | Tanım |
|---|---:|---:|---:|---|
| İzinli katalog satırı | bekliyor | — | — | Kaynakta kabul edilen satır |
| Yayınlanan ürün/varyant | bekliyor | — | — | Bilinçli yayın onayı |
| Gözlenen kullanıcı/görev | bekliyor | — | — | Moderasyonlu gerçek arama görevi |
| Başarılı görev oranı | bekliyor | — | — | Doğru varyant + doğru yönlendirme / tüm görevler |
| Yanlış ürün | bekliyor | — | — | İstenen ürün niyetine uymayan sonuç |
| Yanlış fiyat | bekliyor | — | — | Kaynak fiyat ile gösterilen fiyat farkı |
| Yanlış beden | bekliyor | — | — | Sert beden koşulu ihlali |
| Yanlış stok | bekliyor | — | — | Eski/bilinmeyen stokun kesin güncel sunulması |
| İnsan yönlendirmesi | bekliyor | — | — | Bot olmayan redirect olayı |
| Atfedilen satış | ölçülmüyor/bekliyor | — | — | İmzalı, searchId+offerId taşıyan sipariş |
| Ek satış | ölçülmüyor | — | — | Kontrol grubu olmadan iddia edilmez |
| Aylık işletim maliyeti | bekliyor | — | — | DB+Redis+depo+model+operasyon |
| Ücretli devam isteği | bekliyor | — | — | Evet/hayır, fiyat ve koşul |

`M01` mock koşusunun sonuçları bu tabloya yazılmaz; ayrı koşu kaydında görev bazında tutulur ve yalnız kullanılabilirlik öğrenimi olarak raporlanır.

## Bilinen sınırlamalar ve açık bulgular

- WooCommerce connector basit ve variable ürünleri destekler; gerçek mağazada variation ID/fiyat/stok kaynak mutabakatı henüz yapılmadı.
- MCP otomatik testi tool sonucunu doğrular; gerçek ChatGPT host UI, CSP ve hesap davranışı manuel kabul maddesidir.
- Staging altyapısı ve workflow tanımlıdır fakat gerçek platform erişimi sağlanmadan rollback/restore çalıştırılmış kabul edilmez.
- Kullanıcı araştırması yapılmadığı için arama kalitesi test seti gerçek görev başarısının yerine geçmez.
- Conversion callback'i olmayan mağazada satış ve dönüşüm oranı “ölçülmüyor” kalır.

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
