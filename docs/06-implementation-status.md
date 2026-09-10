# Uygulama durumu — 10 Eylül 2026

Hedef mimari belgeleri daha geniş kapsamı tarif eder. Bu dosya mevcut kodun sınırıdır.

## Tamamlanan temel

- 4 uygulama + 7 ortak workspace paketi, pnpm lockfile, Turbo görevleri, Biome ve CI.
- Zod sözleşmeleri, sert filtreli arama use case'i, in-memory ve PostgreSQL repository.
- Çalışan Fastify arama endpoint'i ve MCP search_products aracı; aynı iş kuralı.
- Next.js demo arama ekranı ve ortak React ürün kartı.
- Vite widget, yerel önizleme ve süreli MCP Apps/ChatGPT host köprüsü.
- CSV parser, BullMQ enqueue/worker, scoped/idempotent DB import transaction.
- 16 tablo, tenant ilişkileri için composite foreign key'ler, sıralı SQL migration'lar ve yerel demo seed.
- CSV, fiyat/beden/stok eşleşmesi, taslak görünürlüğü, girdi doğrulama ve MCP testleri.
- Özel CSV dosya yükleme + outbox/worker import akışı; satır hatası, retry ve tenant kapsamı.
- Ürün yönetim API'si: varyant/fiyat/stok ayrıntısı, owner/editor yayın yetkisi, toplu yayın ve yayın değişikliği audit alanları.
- Ürün görseli/alt metni, güvenli görsel fallback'i ve fiyat/stok kaynak-güncellik bilgisi.
- Başlık/açıklama serbest metin araması, merkezi Türkçe/renk/beden normalizasyonu, kategori/beden/renk facet'leri ve kararlı cursor pagination.
- Arama yanıtlarında `searchId`; güncel stok, stok yok, bilinmiyor ve eski veri durumlarının ayrı sözleşmesi.
- Ölçümlü doğal dil parser sınırı: şemalı model çıktısı, timeout/maliyet tavanı, klasik parser fallback'i, olumsuz renk koşulları ve UI filtresi önceliği.
- 62 etiketli Türkçe sorguluk deterministik kalite seti ve 7 sorguluk kilitli holdout; CI çıktısında prompt/model sürümü, sert ihlal, gecikme ve tahmini maliyet raporu.
- MCP Apps `ui://` ürün kaynağı, standart `ui/*` host köprüsü, ChatGPT uyumluluk metadata'sı, sürümlü widget asset'i ve UI olmadan kullanılabilen metin sonucu.
- Süreli HMAC yönlendirme token'ı, sunucu kaynaklı HTTPS offer hedefi, pasif/yayından kaldırılmış ürün kontrolü ve insan/bot ayrımlı tıklama kaydı. Link üretimi ve satış olayı tıklama tablosuna yazılmaz.
- WooCommerce pilot connector'ı: HTTPS bağlantı doğrulama, sayfalama, `modified_after` artımlı senkron, sınırlı 429/5xx retry, reauthorization durumu ve secret referansı çözümü.
- WooCommerce variable ürün desteği: tüm variation sayfalarını okuma, variation external ID'sini koruma, beden/renk eşleme ve varyant bazında fiyat/stok aktarımı. Eksik variation sayfalaması tam snapshot sayılmaz.
- Beş dakikalık canlı senkron kuyruğu; kaynak/alınma zamanları, son başarı/hata görünümü ve yalnız doğrulanmış tam snapshot'ta eksik offer pasifleştirme.
- First Catalog Import UX: WooCommerce ilk sync durumu connection başına tenant-scoped PostgreSQL kaydında `queued/running/completed/partial/failed` olarak tutulur. Worker katalog sayfalarını okurken bulunan ürün/varyant sayılarını, DB import döngüsü ilerlerken işlenen ürün sayısını kalıcılaştırır; terminal hata bilgisi ve sayaçlar browser state'ine bağlı değildir.
- `GET /v1/connections/:connectionId/sync-status` yalnız oturum açmış kullanıcının üye olduğu merchant kapsamlarında connection arar ve bulunan/işlenen/başarısız/varyant sayaçlarını döndürür. Dashboard layout bu endpoint'i aktif sync sırasında poll eder; sayfa yenilemesi veya yeni UI instance'ı progress'i PostgreSQL'den geri yükler.
- İlk WooCommerce connect HTTP isteği yalnız credential doğrulama, connection/progress kaydı ve BullMQ enqueue yapar; katalog okuma/import döngüsü worker'da kalır. 100 sayfa × 100 ürünlük 10k fixture worker collector sınırını ve request dışı çalışmayı test eder.
- Secret referansı sahipliği merchant+provider+reference kapsamında tutulur; API ve worker başka mağazanın veya sahipliksiz referansın kullanılmasına izin vermez.
- Merchant dashboard WooCommerce onboarding wizard'ı mağaza bilgisi → kaynak seçimi → credential girişi → bağlantı testi → ilk sync → sonuç akışını teknik `secret://` müdahalesi olmadan tamamlar. Consumer key/secret yalnız istek gövdesinde alınır, API/connection response'larında veya browser'a geri gönderilmez; başarılı kurulum ilk BullMQ sync işini başlatır.
- Kullanıcı kontrollü WooCommerce `storeUrl` istekleri SSRF için fail-closed çalışır: yalnız HTTPS/public hedef kabul edilir, local/private cevaplar reddedilir, redirect takip edilmez ve her gerçek connector request'i DNS sonucunu doğruladıktan sonra TLS socket'ini aynı doğrulanmış IP'ye pin eder. Orijinal hostname yalnız Host/SNI ve sertifika doğrulaması için korunur; DNS rebinding/TOCTOU ile ikinci çözümleme yapılamaz.
- Dashboard mağazayı build-time ortam değişkeninden almaz. Oturum üyeliklerini listeler, mağazasız kullanıcıyı kuruluma yönlendirir, tek mağazayı otomatik seçer ve çoklu üyelikte seçim sunar. WooCommerce bağlantısı olan mağaza ilk sync sonucuna yönlendirilir; eski CSV yükleme adımı yalnız CSV akışı için gösterilir.
- Bağlantı ve üyelik yönetiminin owner/editor/viewer kuralları ile çapraz-tenant reddi HTTP entegrasyon testleriyle kapsanır; eşzamanlı setup tek mağaza/üyelik üretir.
- Tenant kapsamlı mağaza raporu: Web/MCP araması, boş sonuç, hata, sayfalama, insan yönlendirmesi, bot önizlemesi, kanal dağılımı, atfedilen satış, net tutar ve açık paydalar. Ham sorgu saklanmıyor; kontrol grubu olmadığı için ek satış bilinçli olarak ölçülmüyor.
- Mağazaya türetilmiş anahtarla imzalanan satış callback'i; sipariş bazında idempotent paid/refunded/cancelled snapshot'ları ve eski olay koruması.
- Immutable image etiketli staging compose/deployment workflow'u, local dışı demo-mode startup engeli, migration öncesi backup ve izole CI restore provası.
- Request/import/job korelasyon alanları, queue-lag ve stale-catalog olayları, secret redaksiyonu ve veri saklama uygulama script'i.
- Discovery session katmanı; surface/transport, başlangıç merchant scope'u ve search/redirect korelasyonu taşır. İstemciden gelen `anonymousUserId` yalnız analytics correlation içindir; authorization veya güvenilir identity sinyali değildir. Server-issued/signed anonymous identity Shopping Profile çalışmasına bırakılmıştır.
- Branded storefront context; public merchant kimliği `displayName`, logo, kapak, ana renk ve `isPublic` alanlarıyla `/shop/[slug]` deneyimine taşınır. Storefront açılışı merchant-scoped discovery session başlatır; “Tüm mağazalarda ara” mevcut session'ı genişletmek yerine yeni `merchantScope=[]` session oluşturur. MVP semantiğinde `isPublic=false`, branded storefront dahil tüm consumer discovery yüzeylerinden kapalı olmak demektir; public discovery session oluşturulamaz ve ürünleri network search'te görünmez.

## Hedef mimariden bilinçli farklar

1. Pilot merchant auth, opaque session, üyelik/rol kontrolü ve kontrollü mağaza kurulumu var; kimlik sağlayıcısı entegrasyonu sonraki dilimdir.
2. Büyük katalogda cursor/chunk işleme ve gerçek object storage entegrasyonu sonraki dilimdir; ilk sürüm özel yerel depolama kullanır.
3. Ürün-varyant kaynak eşlemesi şimdilik connection+external ID kolonlarıyla yapılır. Ayrı SourceRecord/AttributeEvidence daha sonra.
4. Stok güncelliği tarih ve 15 dakikalık UI politikasıyla gösterilir. WooCommerce basit ve variable ürünleri desteklenir; ikinci bir canlı sağlayıcı adaptörü henüz yoktur.
5. OpenAI Responses sağlayıcı adaptörü hazırdır ancak varsayılan kapalıdır. Gerçek hesap, anahtar ve onaylı token fiyatları olmadan canlı model kalite/maliyet karşılaştırması yapılmış sayılmaz; yerel ve CI akışı deterministik parser ile anahtarsız çalışır.
6. ImportRun pending/validating/processing/completed/failed durumları, outbox retry ve satır hatası paneli var; object-storage sağlayıcısı sonraki dilimdir.
7. RLS, public/application/worker DB rolleri ve tenant politikaları migration ile tanımlı; PostgreSQL/Redis entegrasyon paketi ve migration doğrulaması temizdir. Bu teknik kanıt staging yayını veya rollback provası değildir.
8. Widget/MCP sözleşmesi ve yerel entegrasyon testleri hazırdır; gerçek ChatGPT hesabı ile staging TLS oturum testi henüz yapılmadı ve `docs/07-chatgpt-staging.md` içinde açık yayın kapısı olarak kayıtlıdır.
9. WooCommerce connector davranışı sahte HTTP ve gerçek PostgreSQL entegrasyon testleriyle kapsanır; dashboard credential testi ve ilk sync başlatma akışı hazırdır. Kontrollü gerçek pilot mağaza kabulü yine gerçek mağaza URL'si ve geçerli WooCommerce API credential'ı gerektirir.
10. Satış raporu yalnız callback secret'ı ve bağlantı capability'si etkinse ölçülür. Aksi durumda sıfır satış iddiası yerine `not_configured` döner; ek satış/artan etki için deney veya kontrol grubu henüz yoktur.
11. Staging deploy/rollback workflow'u ve runbook hazırdır; gerçek `shopai-staging` runner, GitHub environment secret'ları ve platform erişimleri kurulup workflow URL'si kaydedilmeden canlı rollback provası tamamlanmış sayılmaz.
12. Onboarding'in managed connector secret store'u pilot için private local filesystem'de `0700` directory ve `0600` JSON dosyası kullanır; DB ve browser yalnız opaque reference görür. Bu at-rest encryption değildir. Production readiness öncesi Vault/KMS/managed secret manager tabanlı şifreli depolama, rotation/revocation ve erişim audit'i ayrı güvenlik işi olarak tamamlanmalıdır.
13. WooCommerce sync progress DB'de kalıcı olsa da V1 canlı connector import'u tek katalog transaction'ında tamamlanır; `partial` terminal durumu yalnız bazı işleme adımları tamamlandıktan sonra sonraki sync-finalization adımı hata verirse anlamlıdır. Row-level best-effort partial commit semantiği henüz yoktur.

## Kontrol kapsamı

9 Eylül 2026 tarihli ilk izlenebilir baseline doğrulamasının commit/tag ve temiz-checkout ayrıntıları `docs/release-baseline.md` içindedir:

- Format, lint, paket sınırları, TypeScript ve production build temiz.
- 70 temel test geçti; 3 gerçek WooCommerce prova testi ortam bilgileri olmadığı için bilinçli olarak atlandı.
- 36 PostgreSQL/Redis entegrasyon testi geçti; tenant yönetimi ve kontrollü analitik olay dizisi bu pakete dahildir.
- Migration zinciri temiz bir veritabanına başarıyla uygulandı.

Bu otomatik kanıtlar gerçek WooCommerce mağaza kabulü, TLS staging yayını, gerçek ChatGPT host oturumu veya canlı rollback kanıtı yerine geçmez.

## Açık kabul işleri

| İş | Durum | Tamamlanma koşulu |
|---|---|---|
| Gerçek WooCommerce kabulü | Bekliyor | İzinli mağazada basit/variable ürün, fiyat, stok, fiyat değişikliği ve yayından kaldırma sonuçları kaynakla eşleşir; sürüm ve tarih kaydedilir. |
| TLS staging kabulü | Bekliyor | Yayımlanan SHA readiness yanıtıyla eşleşir; giriş, arama, import ve worker smoke testleri geçer; workflow URL'si kaydedilir. |
| Gerçek ChatGPT host kabulü | Bekliyor | Widget ilk yükleme, arama, filtreli tekrar arama, timeout/hata ve ürün yönlendirmesi yetkili gerçek hostta doğrulanır. |
| Rollback provası | Bekliyor | Önceki immutable SHA yeniden dağıtılır; readiness ve smoke testleri geçer; workflow URL'si ile önceki/yeni SHA kaydedilir. |
| İkinci canlı sağlayıcı | Planlanmadı | Gerçek ikinci kanal müşterisi ve veri sözleşmesi seçildiğinde ayrı adaptör kabul kriterleri tanımlanır. |
