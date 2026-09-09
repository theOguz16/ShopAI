# Güvenlik, işletim ve doğrulama

## Veri ve erişim sınırları

- Public API yalnız yayımlanmış katalog projection'ını okur. Merchant yönetimi üyelik ve rol gerektirir.
- Repository metotları zorunlu merchant scope taşır. RLS tenant tablolarında ek savunma katmanıdır; request/job başına transaction-local scope kullanılır. Connection pool'da önceki tenant context'i kalmamalıdır.
- Public katalog için ayrı DB rolü/projection kullanılır. Worker scoped bağlantı/rol kullanır; global admin yetkisi sıradan job'a verilmez.
- API anahtarları secret manager'da tutulur, DB'de referansı bulunur. LLM, widget, log ve queue payload'ına secret gönderilmez.
- Harici ürün metni güvenilmeyen veridir. Ham HTML çalıştırılmaz; modelin talimat veya tool seçimini değiştirmesine izin verilmez.
- XML/feed ve görsel fetch eklendiğinde SSRF koruması gerekir: private/link-local IP, metadata endpoint, yönlendirme zinciri, boyut ve timeout kontrolü. XML external entity kapatılır.
- Import ham dosyaları private depoda kalır. Görsellerin dışarıdan gösterimi için kullanım izni ve host listesi kaydedilir.
- Analitikte rastgele oturum kimliği kullanılır; kişisel verili query, authorization header ve webhook body varsayılan loglanmaz.
- Kişiselleştirme/veri aktarımı ve ticari statü hukuki değerlendirmesi pilot yayını öncesi gerçek akış üzerinden yapılır. Checkout'a yönlendirme otomatik hukuki muafiyet sayılmaz.

Önerilen başlangıç saklama süreleri: ham import 7 gün, operasyon logu 14 gün, takma kimlikli tıklama 30 gün; anonim aggregate raporlar daha uzun tutulabilir. Bunlar hukuk kuralı değil ürün tasarım varsayımlarıdır; müşteri sözleşmeleriyle netleştirilir. Silme işi backup saklama süresini de hesaba katar.

## Ortamlar ve deployment

- Local: PostgreSQL + Redis compose; örnek izinli/sentetik CSV; gerçek secret gerektirmeyen parser stub.
- Staging: ayrı DB, bucket, secret ve mağaza test bağlantıları; production kişisel verisi kopyalanmaz.
- Production: yönetilen DB, Redis persistence, TLS endpoint, private bucket, ayrı API/worker süreçleri.
- CI: lockfile ile kurulum → lint/typecheck → gerekli testler → build → migration uyumluluk kontrolü.
- Migration yalnız ayrı release job'ında bir kez çalışır. API kopyaları açılışta migration yarışına girmez.
- Expand/contract migration uygulanır; eski API ve eski job payload'ı rollout sırasında çalışmaya devam eder.
- Widget hashed asset'leri eski oturumlar için bir geçiş süresi korunur. API + widget sürümleri eşleştirilir.
- Rollback önce uygulama imajını geri alır; veri kaybettiren down migration otomatik yapılmaz.
- Günlük backup + mümkünse point-in-time recovery; pilot öncesi örnek restore doğrulaması.

## Gözlemlenebilirlik

`request_id`, `search_id`, `import_run_id` ve `job_id` ile trace ilişkilendirilir. Ölçümler: arama p95 gecikmesi, sonuçsuz oran, parser hata/maliyet, sync yaşı, 429 oranı, kuyruktaki en eski iş, invalid satır oranı, tenant erişim reddi, webhook doğrulama hatası.

Başlangıç hedefleri, ölçülmüş SLA değildir: açık filtre araması p95 < 1 sn; parser dahil p95 < 3 sn; canlı sync gecikmesi connector politikasına uygun. Timeout ve maliyet bütçesi aşılırsa klasik filtreleme devreye girer. Aynı normalize ürün içerik hash'i tekrar zenginleştirilmez. Kaynak kesintisi arama servisini tamamen düşürmez; son veri ve güncellik durumu gösterilir.

## Gerekli testler

| Test | Koruduğu risk |
|---|---|
| Merchant A oturumuyla B ürün/import/rapor isteği | Tenant veri sızıntısı |
| Public aramada taslak ve pasif ürün | İzinsiz yayın |
| Aynı import/job iki kere; yarıda kesip devam | Kopya ve veri kaybı |
| Eksik snapshot / invalid satır | Toplu yanlış pasifleştirme |
| Fiyat-stok-beden farklı varyantlarda | Yanlış ürün vaadi |
| Eski webhook yeni veriden sonra | Veri geriye gitmesi |
| Stale CSV ve erişilemeyen connector | Yanlış canlı stok iddiası |
| İmzalı redirect üzerinde oynama / kötü hedef | Open redirect |
| Tekrarlanan conversion + iade | Şişmiş satış raporu |
| Import → yayın → web/MCP arama → yönlendirme | Temel uçtan uca akış |
| Widget yüklenemediğinde tool yanıtı | Kullanılamayan alışveriş akışı |

Türkçe 30–50 değerlendirme sorgusu hazırlanır: olumsuz koşul, bütçe sınırı, çoklu beden, yazım hatası, sıfır sonuç ve prompt injection içeren ürün açıklaması. Sert filtre ihlali sıfır olmalı; ilk beş sonuç uygunluğu insan etiketleriyle ölçülür. Conversion artışı için pilotta yeterli trafik varsa randomize kontrol grubu kullanılır; küçük örneklemde başarı iddiası yapılmaz.
