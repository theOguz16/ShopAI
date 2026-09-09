# ShopAI staging işletim runbook'u

Bu belge çalışır durumdaki kodun işletim sözleşmesidir. Staging ve production aynı veritabanını, Redis'i, secret'ı veya upload volume'ünü paylaşmaz. Production verisi staging'e kopyalanmaz.

## Yayın öncesi erişim ve veri kontrolü

- GitHub `staging` environment onayı: pilot teknik sorumlusu.
- Staging runner ve container registry yazma erişimi: release sorumlusu.
- Staging PostgreSQL/Redis ve private upload volume erişimi: yalnız API/worker çalışma kimliği ve operasyon sorumlusu.
- WooCommerce anahtarı salt-okunur ürün yetkisiyle secret manager'da tutulur; DB'de yalnız `secret://` referansı bulunur.
- `AUTH_PILOT_CREDENTIALS`, normalize e-posta → benzersiz kod JSON eşlemesidir. Ortak kod kullanılmaz; kullanıcı ayrıldığında yalnız kendi girdisi döndürülür.
- Pilot mağazadan ürün, varyant, fiyat, stok, ürün URL'si ve varsa imzalı sipariş snapshot'ı işlenir. Ödeme kartı, müşteri adı, e-posta, adres veya webhook gövdesi tutulmaz/loglanmaz.
- Ürün görseli gösterme izni, tıklama ölçümü, 30 günlük takma kimlikli tıklama ve 365 günlük sipariş aggregate saklama süresi pilot sözleşmesinde onaylanır.
- ChatGPT platform erişimi, izin verilen origin/CSP alanları ve staging TLS sertifikası yayın kontrol listesinde doğrulanır.

## Immutable yayın ve rollback

`.github/workflows/staging.yml` yalnız commit SHA etiketiyle image üretir. GitHub `staging` environment secret'ları compose'a çalışma anında verilir; log veya image katmanına yazılmaz. Migration API başlangıcında çalışmaz ve yalnız deployment job'ındaki ayrı `migrate` rolünde bir kez uygulanır.

Normal yayın:

1. CI `check` ve `integration` job'larının yeşil olduğunu doğrula.
2. `Staging deploy` workflow'unu boş `release_version` ile çalıştır.
3. Job önce DB backup alır, gözden geçirilmiş forward migration'ı uygular, sonra API/worker/web'i değiştirir.
4. `/health/ready` yanıtının `release` alanı yayımlanan SHA ile aynı olmalıdır.
5. Arama, test mağazası araması, bir import ve worker log zinciri smoke-test edilir.

Uygulama rollback'i:

1. Son başarılı deployment kaydındaki image SHA'sını seç.
2. `Staging deploy` workflow'unu o SHA'yı `release_version` olarak vererek çalıştır.
3. Migration geriye alınmaz. Eski sürüm yeni şemayla uyumlu değilse rollout durdurulur ve forward-fix hazırlanır.
4. Readiness ve release doğrulaması workflow tarafından tekrar yapılır.

Bu prosedür self-hosted `shopai-staging` runner, GHCR erişimi ve GitHub environment onayı kurulmadan “denenmiş” sayılmaz. Her denemede workflow URL'si ve önceki/yeni SHA deployment kaydına eklenir.

## Backup ve test restore

`infra/backup.sh` custom-format dump ve SHA-256 manifest üretir. Staging'de şifreli, staging'e özel backup dizinine yazılır. CI her entegrasyon koşusunda dump'ı yeni `shopai_restore_test` DB'sine `infra/restore.sh` ile geri yükler ve migration tablosunu okur. Restore script'i `RESTORE_TARGET=test` ve `ALLOW_RESTORE=true` olmadan çalışmaz.

Elle doğrulama örneği:

```sh
DATABASE_URL="$STAGING_DATABASE_URL" BACKUP_DIR=/secure/shopai-staging-backups infra/backup.sh
DATABASE_URL="$RESTORE_TEST_DATABASE_URL" BACKUP_FILE=/secure/shopai-staging-backups/shopai-TIMESTAMP.dump RESTORE_TARGET=test ALLOW_RESTORE=true infra/restore.sh
```

Günlük backup, 14 günlük saklama ve sağlayıcı destekliyorsa PITR hedeflenir. Üç ayda bir izole test restore yapılır; tarih, dump checksum'ı, süre ve doğrulayan kişi kaydedilir. Production hedefinde otomatik `--clean` restore yasaktır.

## Log korelasyonu ve alarm koşulları

API her yanıtta `x-request-id` döndürür. Import kabul logunda `requestId`, `importRunId`, `merchantId`, `connectionId`; outbox ve worker loglarında aynı `importRunId` ile Bull `jobId` bulunur. Örnek sorgu zinciri:

```text
event=import_accepted importRunId=<run-id>
event=outbox_published importRunId=<run-id> jobId=<run-id>
event=import_completed|import_failed importRunId=<run-id> jobId=<run-id>
```

Uyarı üretilecek yapılandırılmış olaylar:

- `search_error`: web/MCP aramasında 5xx; beş dakikada üç olay alarm.
- `queue_lag`: bekleyen en eski import/sync işi beş dakikadan yaşlı; tek olay alarm.
- `catalog_stale`: etkin bağlantıda son fetch 30 dakikadan eski veya hiç yok; iki ardışık olay alarm.
- `import_failed`, `sync_failed`, `outbox_publish_failed`: merchant/run/job alanlarıyla hata alarmı.

Logger authorization, cookie, callback imzası, giriş token'ı ve connector secret alanlarını redakte eder. Request/webhook gövdeleri loglanmaz.

## Kesinti teşhisi

- `/health/live`: süreç ayakta mı?
- `/health/ready`: katalog repository/DB erişilebilir mi? DB kesintisinde 503 dönmelidir ve trafik instance'a yönlendirilmemelidir.
- Redis kesintisi: API kabul ettiği importu outbox'ta tutar; `outbox_publish_failed` görülür. Redis dönünce aynı run ID ile yayınlanır.
- Eski katalog: `catalog_stale` bağlantı ve merchant kimliğiyle araştırılır; son başarılı sync ve hata panelden kontrol edilir. Başarısız sync ürünleri topluca pasifleştirmez.

## Saklama ve silme

`RETENTION_APPLY=true DATABASE_URL=... UPLOAD_DIR=/var/lib/shopai/uploads infra/retention.sh` günlük çalıştırılır:

- tamamlanmış/başarısız ham import ve run/outbox: 7 gün;
- takma kimlikli yönlendirme tıklaması: 30 gün;
- aggregate conversion sipariş snapshot'ı: 365 gün;
- süresi dolmuş oturum: ek 7 gün.

Backup silinmesi ayrı 14 günlük lifecycle ile yapılır. Hukuki bekletme veya pilot sözleşmesi farklıysa job çalıştırılmadan politika değiştirilir ve migration/review uygulanır.
