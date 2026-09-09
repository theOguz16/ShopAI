# ShopAI ilk pilot özeti

**Karar tarihi:** 9 Eylül 2026

**Pilot türü:** Anlaşmalı butik bulunana kadar sentetik katalogla iç kullanılabilirlik pilotu

**Tek öğrenme hedefi:** Bir alışverişçi, doğal dille tarif ettiği ihtiyaca uyan ürünü doğru beden, fiyat ve stok bilgisiyle bulup doğru ürün sayfasına gidebiliyor mu?

## Kim kullanacak, hangi sorun çözülecek?

Hedef satıcı; ürünlerini dijital katalogdan aktarabilen, beden/renk varyantları bulunan ve kurulum, veri mutabakatı ile sonuç görüşmesine zaman ayırabilecek küçük moda butiğidir. Henüz anlaşmalı butik yoktur. Bu nedenle ilk koşu, gerçek bir markayı taklit etmeyen ve arayüzde **“Demo/sentetik veri — satın alınamaz”** olarak gösterilen mock katalogla yapılır. Mock ürünler gerçek stok, fiyat, marka, satış veya ödeme isteği kanıtı sayılmaz.

İlk değer önerisi: **“Müşterinin tarif ettiği ihtiyaca uygun, doğru beden/fiyat/stok bilgili ürünü bulmasını kolaylaştırmak.”** Pilot; mağaza panelinin genel kullanılabilirliğini, satış artışını veya ChatGPT kanalının ticari etkisini aynı anda kanıtlamaya çalışmaz.

## Katılım ve trafik

- **Şimdi — CSV/mock yolu:** Pilot ekibi, en az 30 sentetik moda ürünü ile beden/renk varyantlarını CSV'den içe aktarır. Beş test katılımcısı web veya yetkili test ChatGPT kanalı üzerinden, senaryoyu yöneten kişiden ürün ipucu almadan beşer görev yapar.
- **Butik bulunduğunda — canlı WooCommerce yolu:** Satıcı yazılı izin verir, salt-okunur API anahtarını secret manager'a yükler ve kaynak–ShopAI ürün/varyant/fiyat/stok mutabakatını tamamlar. Bu yol mock koşunun yerine geçmez; ayrı pilot kodu ve checklist ile başlatılır.
- **Trafik kaynağı:** Mock koşuda bizim davet ettiğimiz, hedef alışverişçi profiline uyan test katılımcılarıdır. Sonraki canlı koşuda öncelik satıcının mevcut kitlesidir; alternatif kanal ancak kaynak adı, davet yöntemi ve uygunluk ölçütü önceden kaydedilirse “doğrulanmış kanal” kabul edilir. Kaynağı belirsiz organik trafik rapora dahil edilmez.

## Süre, görevler ve sorumlular

Hazırlık tamamlandıktan sonra pilot **5 iş günü** sürer: 1 gün veri/erişim kontrolü, 3 gün moderasyonlu görevler, 1 gün analiz ve karar. Ürün sorumlusu kapsamı ve değiştirilemez eşikleri onaylar; teknik sorumlu veri doğruluğu, tenant/yetki ve gözlemlenebilirlik kapılarını doğrular; araştırma sorumlusu katılımcı onamı, görev moderasyonu ve ham gözlem kaydını yürütür. Aynı kişi birden fazla rolü üstlenebilir; isimler başlamadan checklist'e yazılır.

Her katılımcı; ihtiyaca göre ürün bulma, zorunlu beden, renk tercihi, fiyat üst sınırı ve stok/yönlendirme kontrolünü kapsayan **5 önceden yazılmış görev** yapar. Görev, kullanıcı yardım almadan uygun ürünü seçtiğinde ve seçilen varyantın beklenen beden, fiyat ve stok durumuyla doğru hedefe yönlendiği zaman başarılıdır.

## Önceden sabit başarı eşiği

Başlangıç hipotezi **5 kullanıcı × 5 görev = 25 görevdir**. Devam eşiği: en az **20/25 (%80) görev başarısı**, kullanıcı başına en az **3/5 başarı**, başarılı görevlerde **en fazla 90 saniye medyan bulma süresi**, **0 çıkışsız akış** ve aşağıdaki sıfır tolerans koşullarının sağlanmasıdır. Bu küçük, yönlendirilmiş örneklem kullanılabilirlik sorunlarını bulmak içindir; istatistiksel pazar, satış artışı veya ürün-pazar uyumu kanıtı değildir.

Sıfır tolerans: sert beden veya fiyat koşulunu ihlal eden öneri; stokta olmayan/bilinmeyen ürünü kesin stokta gösterme; tenant veri sızıntısı; yetkisiz erişim, yayınlama ya da değişiklik. Bu olaylardan biri görülürse koşu hemen durur, olay kaydedilir ve düzeltme/regresyon doğrulaması olmadan yeniden başlamaz.

Pilot başlamadan önce görev metinleri, beklenen sonuçlar, katalog sürümü, katılımcı kaynağı ve bu eşikler dondurulur. Sonuç görüldükten sonra eşik değiştirilmez; değişiklik gerekiyorsa yeni sürüm ve yeni pilot koşusu açılır. Süre sonunda **devam** yalnız tüm eşikler sağlanırsa; **değiştir** sıfır tolerans korunup görev eşiği kaçırılırsa; **durdur** kritik güvenlik/veri doğruluğu riski kapatılamazsa verilir. Canlı butik pilotuna geçiş için ayrıca izinli satıcı, tamamlanmış kaynak mutabakatı ve atanmış sorumlular gerekir.
