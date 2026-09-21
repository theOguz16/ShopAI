# ShopAI staging + production işletim runbook'u

Bu belge çalışır durumdaki kodun işletim sözleşmesidir. Staging ve production aynı PostgreSQL'i, Redis'i, secret'ı, backup dizinini veya upload volume'ünü paylaşmaz. Production verisi staging'e kopyalanmaz.

Ayrıntılı go-live checklist'i: `docs/production-readiness.md`.

## Yayın öncesi erişim ve veri kontrolü

- Staging ve production çalışma kimlikleri minimum yetkili olmalıdır.
- Connector credential'ları repo'ya yazılmaz; DB'de yalnız `secret://` referansı tutulur ve yerel managed-secret dosyası production/staging'de AES-256-GCM encrypted-at-rest'tir. Bu Vault/KMS entegrasyonu değildir; rotation/audit/migration kapsamı issue #9'da açıktır.
- `AUTH_PILOT_CREDENTIALS`, normalize e-posta → benzersiz credential JSON eşlemesidir. Ortak pilot token kullanılmaz.
- Pilot mağazadan ürün, varyant, fiyat, stok, ürün URL'si ve varsa minimum signed conversion snapshot'ı işlenir. Ödeme kartı, müşteri adı, e-posta, adres veya tam webhook/order gövdesi tutulmaz/loglanmaz.
- Ürün/görsel kullanımı, attribution ve retention süreleri gerçek merchant agreement ile uyumlu olmalıdır.

## Staging doğrulaması

`.github/workflows/staging.yml` bir **deploy workflow'u değildir**. Public staging'e daha önce deploy edilmiş exact release SHA'sını doğrulayan hosted smoke workflow'udur.

Başarılı bir staging evidence run için:

1. `release_version` exact 40-char commit SHA olmalıdır.
2. `scripts/staging-chatgpt-smoke.mjs` public staging API/widget üzerinde çalışır.
3. API readiness'in `release` alanı istenen SHA ile uyuşmalıdır.
4. Workflow run adı `Staging smoke <SHA>` olur.
5. Bu run id normal production deploy'a evidence olarak verilir.

Staging'e hangi mekanizmayla deployment yapıldığı ayrıca operatör sorumluluğudur; smoke geçmeden production deploy açılamaz.

## Production immutable deploy

Production workflow: `.github/workflows/production.yml`.

Normal `deploy` sırası:

1. Target SHA'nın `main` history'sinde olduğu doğrulanır.
2. Aynı SHA için successful `Staging smoke <SHA>` run id zorunludur.
3. GitHub `production` environment approval uygulanır.
4. Exact SHA source'tan GHCR image build edilir ve SHA tag'iyle push edilir.
5. Control files pinned SSH host identity ile production host'a kopyalanır.
6. Host `infra/deploy-release.sh` ile production env/compose contract'ını doğrular.
7. Deployment öncesi DB backup alınır.
8. Forward migration ayrı `migrate` container'ında bir kez çalışır.
9. API/worker/web/widget aynı immutable image SHA ile rollout edilir.
10. Local readiness ve public HTTPS readiness exact release SHA'yı doğrular.

`production` environment minimum GitHub config ve server env sözleşmesi `docs/production-readiness.md` içinde tutulur.

## Application rollback

Rollback bilinçli ve explicit'tir:

1. Daha önce başarıyla yayımlanmış immutable SHA seçilir.
2. `Production release` workflow'u `operation=rollback` ve target SHA ile çalıştırılır.
3. Workflow image'ın GHCR'da varlığını doğrular.
4. `deploy-release.sh` application container'larını eski SHA'ya çevirir.
5. Migration çalıştırılmaz ve migration otomatik geri alınmaz.
6. Exact release readiness tekrar doğrulanır.

Eski application yeni DB schema ile uyumlu değilse rollback yapılmaz; forward-fix release hazırlanır. Şema rollback'i ayrı, review edilmiş bir veri operasyonudur.

## Production secret dosyası

Production host varsayılan olarak `/etc/shopai/production.env` kullanır. Dosya `chmod 600` olmalıdır; deploy script group/world-readable secret dosyasını fail-closed reddeder.

Secret dosyası GitHub Actions loglarına veya image katmanına kopyalanmaz. GitHub workflow yalnız release metadata, SSH erişimi ve kısa ömürlü GHCR workflow token'ını kullanır.

## Backup ve test restore

`infra/backup.sh` custom-format PostgreSQL dump ve SHA-256 manifest üretir. CI her integration koşusunda dump'ı izole test DB'sine `infra/restore.sh` ile geri yükler.

Production deploy'da backup migration'dan önce alınır. Production target'a destructive otomatik restore yoktur. Production restore ayrı incident/change prosedürü gerektirir.

Hedef:

- günlük production backup;
- yaklaşık 14 günlük backup retention veya sağlayıcı policy'si;
- sağlayıcı destekliyorsa PITR;
- en az üç ayda bir isolated restore rehearsal.

Her restore rehearsal tarih, dump checksum, süre ve doğrulayan kişi ile kaydedilmelidir.

## External operations alerting

Production API ve worker şu kritik olayları configured external alert sink'e iletir:

- `search_error`;
- `request_failed`;
- `queue_lag`;
- `catalog_stale`;
- `import_failed`;
- `sync_failed`;
- `outbox_publish_failed`;
- `scheduler_failed` ve worker-level errors.

Payload HMAC-SHA256 ile imzalanır:

```text
x-shopai-alert-timestamp: <unix-ms>
x-shopai-alert-signature: sha256=<HMAC(secret, timestamp + "." + rawBody)>
```

Alert sink erişilemezse ShopAI request/job execution fail ettirilmez; delivery failure local structured warning olarak kalır. Receiver replay/freshness kontrolü ve gerçek on-call routing uygulamalıdır.

Önerilen eşikler:

- search/request 5xx: 5 dakikada >=3 → page;
- queue lag: 5 dakikadan eski job → warning/page;
- aynı catalog connection iki ardışık stale gözlem → page;
- import/sync/outbox failure → tek olay warning veya page.

## Log korelasyonu

API yanıtı `x-request-id` taşır. Import/sync logları `merchantId`, `connectionId`, `importRunId` ve/veya Bull `jobId` ile korele edilir.

Logger authorization, cookie, callback imzası, login token'ı ve connector credential alanlarını redakte eder. Raw request/webhook body operational alert payload'una gönderilmez.

## Kesinti teşhisi

- `/health/live`: süreç ayakta mı?
- `/health/ready`: repository/DB erişilebilir mi ve doğru release mi?
- Redis kesintisi: import outbox event'i DB'de kalır; publisher retry eder.
- `queue_lag`: Redis/Bull worker throughput ve oldest job incelenir.
- `catalog_stale`: connection son başarılı sync, authorization status ve connector upstream hataları incelenir.
- `sync_failed`: connector HTTP diagnostics credential-redacted olarak kullanılır.

## Saklama ve silme

`infra/retention.sh` kontrollü olarak şu teknik varsayımları uygular:

- tamamlanmış/başarısız raw import/run/outbox: yaklaşık 7 gün;
- pseudonymous redirect/click kayıtları: yaklaşık 30 gün;
- minimize edilmiş interaction event kayıtları: yaklaşık 90 gün;
- attributed conversion aggregate snapshot: yaklaşık 365 gün;
- expired session: kısa operational grace period.

Backup lifecycle ayrıdır. Legal hold, merchant agreement veya final Privacy Policy farklı süre isterse retention job production'a uygulanmadan önce policy/code/migration birlikte review edilmelidir.

## Legal gate

Repo'daki legal dokümanlar draft'tır:

- `docs/legal/privacy-policy-draft.md`
- `docs/legal/terms-of-service-draft.md`
- `docs/legal/merchant-pilot-agreement-draft.md`

Placeholder ve counsel/authorized owner approval tamamlanmadan production launch sign-off verilmez.
