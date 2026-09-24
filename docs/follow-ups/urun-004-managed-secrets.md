# ÜRÜN-004 — connector secret yaşam döngüsü

## Production provider kararı

VDS üzerinde API ve worker container'ları, PostgreSQL ve Redis çalışıyor. Production için **yalnız AWS Secrets Manager** seçildi. HashiCorp Vault bu tek VDS dışında HA, unseal, token ve backup işletimi gerektirir. Secrets Manager ayrı sunucu gerektirmez; AWS hizmet ve API çağrısı başına ücret, AWS ağına bağımlılık ve IAM credential yönetimi getirir. Fiyat ve erişilebilirlik için dağıtım öncesi AWS hesabında güncel koşullar gözden geçirilmelidir. AWS varsayılan KMS anahtarı kullanılabilir; müşteri yönetimli KMS anahtarı seçilirse onun anahtar, izin ve ücret yaşam döngüsü de operatöre aittir.

`secret://ONBOARDING_...` opaque sözleşmesi korunur. Secrets Manager nesne adı `shopai/<environment>/<merchant>/<connection>/<provider>/<opaque-id>` biçimindedir; sağlayıcı değeri yalnız API ve worker sunucu sürecinde çözülür. PostgreSQL'deki `connector_secrets` satırı merchant, connection, provider, reference, version, backend ve active/revoked durumunu tutar. Worker bu eşleşmeyi çözümlemeden önce kontrol eder. API onboarding/rotation için oluşturma, çözümleme ve revoke; worker yalnız çözümleme yapar. Browser yanıtları, Redis işleri, analytics, log ve hata yanıtları credential veya managed reference içermez.

API ve worker başlangıçta namespace içindeki `shopai/<environment>/health` sentinel secret'ını okur. Başarısız okuma başlatmayı engeller; API readiness aynı kontrolü yapar. AWS kesintisinde yeni credential işlemleri ve sync çözümlemesi başarısız olur; DB durumu yerel dosyaya otomatik düşmez. Bağlantı revoke işlemi önce DB'de atomik yapılır; provider silme çağrısı başarısızsa erişim yine engellenir ve operatör cleanup retry uyarısı alır. AWS deletion yedi günlük recovery penceresiyle planlanır.

## Ortam ve erişim politikası

| Ortam | Backend | Politika |
| --- | --- | --- |
| local/test | `file` varsayılan, test için `aws` açık seçilebilir | PR #61 AES-256-GCM private volume biçimi korunur. |
| staging | `file` açık fallback veya `aws` | Gerçek kabul için ayrı `shopai/staging` namespace, ayrı test credential ve ayrı IAM kimlikleri gerekir. |
| production | yalnız `aws` | `file`, eksik region/namespace/health config veya okunamayan health secret ile API/worker başlamaz. `shopai/production` zorunludur. |

VDS compose API ve worker'a ayrı IAM access key enjekte eder. API rolüne yalnız production namespace altında `CreateSecret`, `GetSecretValue`, `DeleteSecret` ve health secret okuma; worker rolüne yalnız `GetSecretValue` ve health secret okuma verilmelidir. İki rolün staging namespace erişimi olmamalıdır. Customer KMS key seçilmişse API'ye encrypt/data-key, API ve worker'a decrypt izni yalnız ilgili key üzerinde verilir. Runtime kimlikleri ve key'ler dağıtım secret kaynağından enjekte edilir; repoya yazılmaz. Operatör IAM access key'leri yeni key'i ekleyip health/sync kontrolü yaparak, ardından eskisini devre dışı bırakıp silerek döndürür. KMS customer key rotation ve erişim değişikliği AWS politika/anahtar prosedürüyle yürütülür. Bu PR otomatik credential/key rotation yapmaz.

AWS Secrets Manager replikasyon/şifreleme hizmeti sağlar; uygulama DB snapshot'ı tek başına geri yükleme değildir. Recovery tatbikatı izole staging DB restore ile aynı namespace secret sürümlerini eşlemeli, health ve scoped resolution'ı doğrulamalıdır. Secret silme sonrası yedi günlük AWS recovery penceresi ve yerel backup retention ayrı izlenmelidir. Gerçek staging restore tatbikatı henüz yapılmadı.

## Pilot migration ve rollback

`scripts/migrate-connector-secrets.mts` varsayılan `plan`, `--apply`, `--rollback` ve `--cleanup --confirm-retired-file-deletion` kiplerini sunar. Yalnız local/staging çalışır; production migration otomatik uygulanmaz. AWS hedefi için `CONNECTOR_SECRET_BACKEND=aws`, region, namespace, health ID ve AWS kimliği gerekir. Eski private volume encryption key kaynak çözümlemesi için gerekir.

`--apply` her etkin bağlantının eski dosyasını çözer, AWS'de scoped secret oluşturur, aynı scope ile okuyup credential şemasına göre karşılaştırır ve ancak sonra transaction içinde PostgreSQL reference/backend/version geçişi yapar. Yeniden çalışma zaten AWS aktif olanları atlar. DB yarışında yeni nesne silme için planlanır. Eski dosya rollback için tutulur. `--rollback` yalnız metadata'sı olan eski **scoped** file sürümünü doğrulayıp transaction içinde tekrar active yapar; eski plaintext/unscoped pilot dosyasına otomatik rollback yoktur. Bu tür bağlantıda rollback için operatör ayrı, tenant doğrulamalı recovery planı hazırlamalıdır. `--cleanup` 30 gün geçmiş migration audit kayıtlarını tarar, hâlâ aktif AWS hedefini okur ve yalnız emekliye ayrılmış eski dosyayı siler. Filesystem `unlink` fiziksel blokların veya backup kopyalarının güvenli silindiğini kanıtlamaz; plaintext pilot backup kopyaları retention sonunda ayrıca yok edilmelidir. Cleanup production'da çalışmaz.

## Issue #9 kabul matrisi

| Kabul maddesi | Durum | Kanıt / açık iş |
| --- | --- | --- |
| Production manager ile at-rest encryption | OPEN | AWS Secrets Manager adapter ve production config var; gerçek staging/production provider kabulü yapılmadı. |
| Server-side provider ve browser'da credential/reference yok | PASS | `secret-backend.ts`, API/worker inject, onboarding response şeması ve mevcut integration testleri. |
| Hesap yeniden açmadan rotation ve revocation | PASS | Mevcut PR #61 DB lifecycle; backend create/revoke adapter ve unit test. Gerçek staging operasyonu ayrıca açık. |
| Merchant/provider/reference/actor access audit | PASS | `connector_secret_audit`, worker çözümleme eventleri ve mevcut integration testleri. |
| Log, error, analytics, queue'da credential yok | PASS | Opaque queue ID, generic provider errors ve redaction testleri; gerçek staging gözlemlemesi açık. |
| Pilot filesystem migration ve plaintext safe deletion | OPEN | Plan/apply/verify/rollback/explicit cleanup kodu var; gerçek staging rollout, backup retention ve plaintext fiziksel silme kanıtı yok. |
| Production pilot backend ile fail-closed | PASS | API/worker env testleri, startup AWS health read ve production compose zorunlu AWS ayarları. |

Ürün durumu: **KISMİ / OPEN**. Staging'de ayrı gerçek AWS namespace/kimlik ve kontrollü credential ile create, API/worker resolve, successful ve failed rotation, revoke, eski enqueue job, audit, migration retry/rollback/cleanup ve recovery tatbikatı kanıtlanmadan ÜRÜN-004 tamamlandı sayılmaz. Production secret veya migration bu PR için kullanılmaz.
