# Uygulama sırası ve karar kaydı

## İş sırası

| İş | Kapsam | Durum | Tamamlanma ölçütü |
|---|---|---|---|
| S01 | pnpm repo, TS, lint, task runner, lockfile | Tamamlandı | Temiz kurulum ve uygulama build'leri |
| S02 | contracts, DB migration, merchant üyeliği | Tamamlandı | A/B tenant ve rol erişim testleri geçiyor |
| S03 | CSV import, worker, outbox, hata raporu | Tamamlandı | Aynı dosya tekrarında kopya yok; hata/retry gözlenebilir |
| S04 | Yayın kontrolü, filtreli katalog arama | Tamamlandı | Taslak dışarı çıkmıyor; varyant filtreleri doğru |
| S05 | Web keşfi ve oturum tabanlı çoklu mağaza paneli | Tamamlandı | Kullanıcı kendi mağazasını kurup/seçip yönetebiliyor |
| S06 | Query parser ve Türkçe eval seti | Tamamlandı | Sert filtre ihlali yok; fallback çalışıyor |
| S07 | MCP araçları, widget ve host köprüsü | Teknik tamamlandı; gerçek host kabulü bekliyor | Web/MCP aynı iş kuralını izler; gerçek ChatGPT senaryoları ayrıca geçer |
| S08 | İmzalı redirect ve tıklama raporu | Teknik tamamlandı; staging kabulü bekliyor | Yönlendirme kaydedilir, URL üretimi sayılmaz; canlı hedef doğrulanır |
| S09 | WooCommerce simple/variable connector | Teknik tamamlandı; gerçek mağaza kabulü bekliyor | Otomatik sync güvenliği ve gerçek kaynak mutabakatı geçer |
| S10 | Conversion adaptörü, yalnız destek varsa | Teknik tamamlandı | Tekrarlanan sipariş/iade doğru hesaplanır; callback yoksa ölçülmüyor gösterilir |
| S11 | Staging/pilot yayını ve operasyon kontrolü | Bekliyor | TLS E2E, gerçek ChatGPT host ve rollback kanıtı tamamlanır |

S10 satış kanıtı yoksa ertelenir; demo ve tıklama raporu buna bağımlı değildir. S07 erken teknik risk denemesi için sentetik veriyle S03 sürerken ayrıca yapılabilir. Bu iş sıralaması kişi veya süre taahhüdü değildir.

## İlk geliştirme dilimi — tamamlanan başlangıç hedefi

Başlangıç hedefi bir merchant, üç varyantlı örnek ürün, CSV import, SQL filtreleme, ürün kartı ve doğru mağaza bağlantısıydı. Bu kapsam tamamlandı; aynı `SearchProducts` use case'i MCP'ye bağlandı ve dashboard oturum tabanlı çoklu mağaza yönetimine genişletildi. Canlı dış kabul kanıtları S07–S11 durumlarında ayrıca tutulur.

## Mimari kararlar

| Karar | Gerekçe | Yeniden değerlendirme tetikleyicisi |
|---|---|---|
| pnpm monorepo | Tek dil, ortak sözleşmeler, atomik değişiklik | Ekip/teknoloji sınırları ayrışırsa |
| Modüler monolit + worker | İş kuralları ortak, uzun işler request dışında | Ölçülen bağımsız ölçek ihtiyacı |
| REST ve MCP aynı API | Auth ve arama kurallarının tekrarını önler | MCP trafik/erişim politikası ayrışırsa |
| CSV ilk adaptör | Gerçek veriyle en kısa doğrulama | Pilot mağazanın canlı kaynak ihtiyacı |
| Product/Variant/Offer ayrımı | Beden-fiyat-stok tutarlılığı | Mağazalar arası ürün eşleme gerekirse |
| PostgreSQL ilk arama | İşletim yükü düşük ve filtreler kesin | Eval doğruluğu/gecikme hedefleri karşılanmazsa |
| Anonim keşif | Kullanıcı hesabı ilk akışı zorlaştırmaz | Wishlist/profil talebi doğrulanırsa |
| Dış checkout | Pilot ürün keşfine odaklanır | İş modeli ve platform erişimi doğrulanırsa |
| Gemini adaptörü sonra | İlk kanalı öğrenmeden yayılmayı önler | Gerçek ikinci kanal müşterisi varsa |

## Canlı kabul öncesi dış bağımlılıklar

- İlk merchant, ürün kullanım/yayın izni ve veri dosyası.
- İzinli WooCommerce pilot mağazası, ürün kullanım/yayın izni ve salt-okunur API erişimi.
- Kalıcı auth sağlayıcısı seçimi; mevcut pilot auth canlı kimlik sağlayıcısı değildir.
- Staging alan adı, TLS, hosting hesabı, runner ve registry erişimi.
- LLM hesabı, model ve aylık bütçe; model ID config olur, koda gömülmez.
- Yetkili gerçek ChatGPT hesap/workspace'i ve staging MCP bağlantı testi.
- Checkout hedefi ve satış attribution verisinin gerçekten alınabilirliği.

Bu maddeler mimariyi yazmayı engellemez. Gerçek bağlantı ve yayın aşamasında ilgili erişimler gerekir.

## Pilotun devam kararı

Teknik çıktı: güvenilir katalog, doğru varyant, çalışan web/MCP akışı, gözlemlenebilir senkron.

Ticari çıktı: kullanıcı uygun ürünü buluyor; mağaza sonucu görüyor ve ücretli devam etmeyi kabul ediyor. Bağlanan SKU sayısı veya sadece tool çağrısı ticari doğrulama sayılmaz. Marka kendi trafiğini getiriyorsa ölçülen ilk değer dönüşüm desteğidir; yeni müşteri kazanımı ayrıca ölçülür.
