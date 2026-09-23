# ÜRÜN-004 — connector secret yaşam döngüsü

## Mevcut durum ve karar

Önceki akışta onboarding credential'ı API isteğinde doğar, connector ile doğrulanır, `UPLOAD_DIR/connector-secrets` altında AES-256-GCM dosyasına yazılır ve DB'ye `secret://` referansı kaydedilirdi. Worker yalnız merchant/connection ID içeren BullMQ işinden bağlantıyı bulur ve dosyayı çözerdi. Eski pilot dosyaları plaintext olabilir; worker ortamındaki eski `secret://NAME` referansları da desteklenir. Rotation, dosya revocation ve erişim audit'i yoktu. [Issue #9](https://github.com/theOguz16/ShopAI/issues/9) bu pilot sınırını production secret manager gereksinimi olarak açık tutuyor.

Bu değişiklik için **tek uygulama yönetimli yaklaşım** seçildi: VDS private volume üzerinde AES-256-GCM dosyaları, deployment ortamından verilen ayrı 256 bit anahtar ve PostgreSQL'de connection kapsamlı sürüm/aktiflik metadata'sı. Yeni dosyanın authenticated associated data'sı merchant, connection ve provider kimliklerini içerir; başka kapsamda çözümleme kriptografik olarak başarısız olur. Worker DB'de aynı merchant/connection/provider/reference ve `active` durumunu kontrol eder. DB'de plaintext veya şifreli credential gövdesi tutulmaz. `secret://` biçimi korunur. Plaintext cache/Redis kullanılmaz.

Bu seçim mevcut API/worker shared private volume ve ayrı staging/production anahtar düzenine en az yeni operasyon ekler. Ayrı Vault hizmetinin işletimi, erişim token'ı ve HA/backup gerektirmez. **Buna karşın Vault/KMS/managed provider değildir**: VDS ile deployment anahtarına birlikte erişen saldırgan dosyaları çözebilir; uygulama süreci de gerektiğinde plaintext görür. Issue #9'un harici secret manager maddesi ve production güvenlik kabulü açık kalır. Production için bu sınır ayrıca onaylanmadan PASS verilmez.

## Davranış ve tehdit sınırı

- API `owner/editor` onboarding sırasında dosyayı bağlantı ID'sine bağlar. `owner` rotation yapar. Connector doğrulaması başarısızsa eski aktif sürüm korunur; yeni dosya kaldırılır. Başarılı doğrulamada PostgreSQL transaction'ı referans değişimini, eski sürümün `rotated` durumunu ve audit'i birlikte yazar. Eski dosya 30 günlük rollback/forensics penceresi için şifreli kalır; normal worker yolu eski sürümü reddeder. Fiziksel dosya silme operatörün kontrollü temizlik adımıdır.
- `owner` disconnect yaptığında bağlantı ve aktif secret aynı transaction'da revoked olur. Sonradan başlayan queue işi connection aktiflik sorgusunda atlanır. Çalışmakta olan network isteğinin anlık iptali garanti edilmez; provider tarafı credential iptali ayrıca gerekir.
- Worker her sync işi başında bir `accessed` olayı yazar. Her HTTP sayfası/ürün için yazmaz. Başarısız çözümleme `resolution_failed` olur. Olaylar actor, tenant, connection, reference ve varsa request ID taşır; secret value taşımaz. Queue yalnız ID taşır. Managed reference browser'a döndürülmez ve elle connection'a atanamaz.
- API/worker şifreli dosyalara ve deployment anahtarına erişir. DB RLS merchant kapsamını korur. Host root, DB owner veya aynı anda volume+key erişimi bu sınırın dışındadır. Credential'lar process belleğinde connector çağrısı süresince bulunur.
- Staging ve production farklı key, volume, DB ve backup kullanır. Şifreli dosya backup'ı ile key ayrı güvenli kasada saklanmalıdır; yalnız DB restore'u secret'ları geri getirmez. Restore önce izole ortamda dosya+DB+uygun key ile doğrulanır. Anahtar kaybında credential'lar kurtarılamaz. Deployment anahtarının yeniden anahtarlanması ayrı operatör prosedürüdür; bu PR otomatik key rotation sağlamaz.

## Migration ve rollback

`scripts/migrate-connector-secrets.mts` varsayılan olarak yalnız plan sayısı üretir. `--apply` yalnız local/staging'de çalışır; production ortamında fail eder. Her bağlantı için eski ref çözülür, yeni scoped şifreli dosya oluşturulur, tekrar çözülerek karşılaştırılır ve ardından DB transaction'ında yeni ref/sürüm etkinleştirilir. Ref değişmişse geçici dosya temizlenir. Yeniden koşu yeni metadata'lı bağlantıyı atlar. Eski dosya/ortam secret'ı başarı kanıtı ve rollback penceresi bitmeden silinmez; işlem hiçbir credential değerini yazdırmaz. Rollback, eski referansı ve eski worker release'ini kontrollü transaction/deploy ile geri getirir; production'da bu komut çalıştırılmaz.

Staging rollout: yedek ve izole restore, DB migration `0034`, API+worker shared volume/key kontrolü, plan, `--apply`, bağlantı bazlı sync/audit kontrolü, eski ref'in çalışmadığının doğrulanması. Production: ayrı change approval, mevcut ref envanteri, backup/restore ve sağlayıcı credential iptal planı gerekir. Production verisi bu PR'da taşınmadı veya rotate edilmedi.

## Kabul durumu

- Kod/test: scoped encryption, rotation/revocation, tenant RLS, queue fail-closed ve migration retry yerel PostgreSQL/Redis üzerinde doğrulandı (27 dosya, 142 test); `pnpm check` PASS. CI aynı SHA üzerinde ayrıca teyit edilir.
- Staging: uygulanmadı; shared volume, ayrı key, restore ve mevcut bağlantı migration kanıtı bekler.
- Production: uygulanmadı; issue #9 harici managed provider koşulu, gerçek operasyon ve key yönetimi açık.
