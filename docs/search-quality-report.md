# Arama kalitesi raporu — 2026-09-09

## Karar özeti

Deterministik arama, genişletilmiş 69 sorguluk niyet ölçümünde **0 sert filtre ihlali**, 5 katalog görevinde **5/5 başarı** ve sonuçlarda **0 sert filtre ihlali** verdi. Bu küçük sentetik ölçüm pazar kanıtı veya gerçek kullanıcı kabulü değildir. Gerçek kullanıcı ifadeleri geldikçe yeni örnekler önce holdout'a eklenmeli, başarı eşiği sonuç görüldükten sonra değiştirilmemelidir.

## Başarı tanımı ve kapsam

| Ölçüm | Adet | Başarı tanımı | Sonuç |
| --- | ---: | --- | ---: |
| Geliştirme niyet seti | 62 sorgu | Etiketli her sert filtre alanı birebir doğru | 62/62 |
| Kilitli holdout | 7 sorgu | Etiketli her sert filtre alanı birebir doğru | 7/7 |
| Kullanıcı görevi | 5 görev | Beklenen varyant sonuçta; no-match görevinde sonuç boş | 5/5 |
| Sonuç güvenliği | Dönen tüm ürünler | Uygulanan beden, renk, kategori, fiyat aralığı ve stok koşulunu ihlal etmez | 0 ihlal |

Set renk/olumsuz renk, dört ürün kategorisi, XS–XXL bedenler ve sözel karşılıkları, fiyat üst sınırı/aralığı, stok tercihi, tek karakter yazım hatası ve karşılıksız isteği kapsar. Marka, sayısal beden, birden fazla para birimi, sıralama tercihi, öznel kalite, geniş ürün sınıfları ve gerçek katalog dil çeşitliliğini henüz kapsamaz.

## En büyük üç başlangıç başarısızlığı

Yeni zorluk seti önceki `deterministic-v2` davranışına uygulandığında 16 sorgunun yalnız 2'si tüm beklenen alanları karşılıyordu. En büyük üç sınıf:

| Sınıf | Etkilenen sorgu | Önceki etki | Düzeltme | Güncel sonuç |
| --- | ---: | --- | --- | ---: |
| Yazım hatası | 6 | Renk veya kategori algılanmıyor; serbest metin doğru ürünü eliyordu | Bilinen katalog sözlüğünde tek ekleme/silme/değiştirme veya komşu harf yer değiştirmesine toleranslı genel normalizasyon | 6/6 |
| Bütçe aralığı | 4 | Alt sınır sözleşmede yoktu; aralık metni serbest aramada kalıyordu | `minPriceMinor` sözleşmesi, iki uç doğrulaması ve memory/PostgreSQL filtreleri | 4/4 |
| Farklı beden yazımı | 4 | “bedenim XL” ve “M-beden” gibi kalıplar kaçıyordu | Konum ve tire varyasyonlarını kapsayan beden dilbilgisi | 4/4 |

Başlangıç kullanıcı görev sonucu 2/5 (%40) idi. Düzeltmeden sonra 5/5 (%100). Örnek eski başarısızlıklar: “siayh M beden tişort”, “800 ile 1.000 TL arası…” ve “bedenim XL”. Bu artış yalnız sentetik beş görev içindir; genellenebilir kullanıcı başarısı iddiası değildir.

## Güvenlik ve model karşılaştırması

“mor elbise” görevinde katalog karşılığı olmadığı için sonuç boş kalır; filtre kendiliğinden gevşetilmez ve uydurma ürün üretilmez. Alt fiyatın üst fiyattan büyük olduğu istek şema sınırında reddedilir. Açık UI seçimlerinin parser yorumuna önceliği korunur.

Bu raporda gerçek model deneyi yapılmadı; dolayısıyla modelin deterministik sürümden iyi olduğu yönünde iddia, gerçek model maliyeti veya gecikme ölçümü yoktur. Model adaptörünün timeout, şema hatası, maliyet tavanı ve deterministik fallback davranışları ayrı otomatik testlerde doğrulanır.

## Sonraki ölçüm

İlk 5 kullanıcı × 5 görev gözleminde görev metni, başarı/başarısızlık sınıfı ve düzeltme gereksinimi anonim olarak kaydedilmeli; ham kullanıcı sorguları ürün telemetrisine kalıcı olarak eklenmemelidir. En az üç gerçek başarısız örnek bir sınıfta birikmeden yeni arama altyapısı veya model yatırımı kararı verilmemelidir.
