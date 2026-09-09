# ShopAI pilot kabul checklist'i

Bu liste 1–3 gerçek mağaza için ayrı ayrı doldurulur. Kanıt alanı boş olan madde geçmiş sayılmaz. Müşteri adı yerine pilot kodu (`P01`–`P03`) kullanılır; secret, müşteri kişisel verisi ve ham sipariş gövdesi belgeye yazılmaz.

Anlaşmalı butik bulunmadan önce yapılacak `M01` mock koşusu gerçek mağaza kabulü değildir. Kapsam, değiştirilemez başarı eşiği, durdurma koşulları ve CSV/canlı WooCommerce ayrımı `docs/pilot-brief.md` içindedir. Mock koşuda yalnız uygulanabilir maddeler doldurulur; mağaza izni, canlı WooCommerce, satış ve ödeme isteği alanlarına `uygulanamaz — mock` yazılır ve başarı iddiasına katılmaz.

## 1. Başlangıç ve izinler

- [ ] Pilot türü ve veri kaynağı kaydedildi: `M01 mock CSV / P__ canlı WooCommerce`
- [ ] Ürün, sorumlu, teknik ve araştırma sorumlularının isimleri kaydedildi: `____`
- [ ] Görevler, beklenen sonuçlar, katalog sürümü ve başarı eşikleri ilk katılımcıdan önce donduruldu. Kanıt: `____`
- [ ] Pilot kodu ve mağaza sorumlusu kaydedildi: `P__ / ____`
- [ ] Katalog, görsel ve ürün bağlantılarının işlenmesi için yazılı izin alındı. Kanıt: `____`
- [ ] WooCommerce anahtarı salt-okunur ve secret manager'a yüklendi. Referans: `____`
- [ ] Tıklama ölçümü, saklama süreleri ve varsa aggregate satış callback'i mağazaya anlatıldı/onaylandı. Kanıt: `____`
- [ ] Staging DB, Redis, upload deposu ve backup production'dan ayrıdır. Deployment URL/SHA: `____`
- [ ] ChatGPT test hesabı/workspace'i ve staging MCP erişimi yetkilidir. Hesap kodu: `____`

## 2. Otomatik kabul

Test öncesinde aşağıdaki değerler CI/GitHub `pilot` environment secret/variable alanlarında tutulur:

```text
PILOT_WEB_URL
PILOT_API_URL
PILOT_MERCHANT_ID
PILOT_MERCHANT_EMAIL
PILOT_LOGIN_TOKEN                 # secret
PILOT_EXPECTED_PRODUCT_TITLE
PILOT_EXPECTED_EXTERNAL_ID
PILOT_EXPECTED_SIZE
PILOT_EXPECTED_COLOR
PILOT_EXPECTED_PRICE_MINOR
PILOT_EXPECTED_CHECKOUT_URL
```

- [ ] `pnpm test:e2e:pilot` geçti. Run URL / release SHA: `____`
- [ ] Giriş → CSV yükleme → durum takibi → taslak → yayın akışı geçti.
- [ ] Hatalı CSV satır nedeni gösterdi ve kullanıcı tekrar yükleme yapabildi.
- [ ] Web araması beklenen başlık, beden, renk, fiyat ve stok durumunu döndürdü.
- [ ] İmzalı redirect yalnız onaylı mağaza origin'ine yöneldi.
- [ ] MCP sonucu web ile aynı ürün/varyant/fiyatı döndürdü.
- [ ] Yetki, tenant izolasyonu ve yanlış varyant regresyon testleri yeşil. CI URL: `____`

## 3. Gerçek ChatGPT ve kullanıcı gözlemi

- [ ] Gerçek ChatGPT oturumunda kart render edildi. Hesap/host/widget sürümü: `____`
- [ ] Widget beden değişimi doğru varyantı döndürdü.
- [ ] Widget yüklenmediğinde metin tool sonucu kullanılabilir kaldı.
- [ ] En az 5 gerçek görev gözlemlendi; yönlendirmesiz soru sorulup kullanıcı davranışı kaydedildi.
- [ ] Görev başarı sayısı: `__/__`; medyan bulma süresi: `____ sn`.
- [ ] Kullanıcı yanlış sonuçtan nasıl kurtulacağını anlayabildi; çıkışsız akış sayısı: `__`.

Her sorun ayrı kaydedilir:

| ID | Pilot | Sorgu/görev | Tür | Beklenen | Gerçek | Şiddet | Durum |
|---|---|---|---|---|---|---|---|
|  |  |  | yanlış ürün / fiyat / beden / stok / yetki / çıkışsız akış |  |  | kritik/yüksek/orta/düşük |  |

Kritik: tenant/veri sızıntısı, yetkisiz yayın/değişiklik veya kullanıcının yanlış fiyat/beden/stokla satın almaya gönderilmesi. Açık kritik ya da yüksek yanlış-varyant hatası varken pilot genişletilmez.

## 4. Olay ve rapor mutabakatı

- [ ] Test aramasının `searchId` değeri kaydedildi: `____`
- [ ] İnsan tıklaması redirect logu ve mağaza raporunda bir kez göründü.
- [ ] Bot/link preview insan tıklamasına eklenmedi.
- [ ] Satış callback'i etkinse aynı sipariş iki kez gönderildi, gelir tek sayıldı.
- [ ] İade/iptal test edildi ve net tutar kaynak mağaza raporuyla uyuştu.
- [ ] Callback yoksa panel “0 satış” değil “Ölçülmüyor” gösterdi.
- [ ] ShopAI raporu ile kaynak olaylar arasındaki fark: `____`; açıklama: `____`.

## 5. İşletim ve ticari görüşme

- [ ] Pilot dönemi/tarih aralığı ve saat dilimi kaydedildi.
- [ ] Uptime, search p95, queue lag, stale katalog ve hata sayıları kaydedildi.
- [ ] Aylık DB/Redis/depo/model/operasyon maliyeti hesaplandı.
- [ ] Mağaza sorumlusuna “Bu ürün için ayda ___ TL öder misiniz?” soruldu; yanıt ve koşullar kaydedildi.
- [ ] Veri silme talebi ve pilot kapanış prosedürü doğrulandı.
- [ ] `docs/pilot-results.md` kanıtlarla güncellendi ve devam/değiştir/durdur kararı imzalandı.
