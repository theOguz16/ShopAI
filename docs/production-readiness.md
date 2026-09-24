# TASK-021 — Production Readiness Gate

Bu belge production'a çıkış için **tek kaynak checklist** olarak kullanılmalıdır. Kodun var olması ile gerçek production kabulü aynı şey değildir. Bir madde yalnız kanıtı varsa tamamlanır.

TASK-021'in görev seviyesi mühendislik/dış kabul özeti `docs/06-implementation-status.md` içindeki kanonik tabloda tutulur. Bu dosya production gate'lerinin ayrıntılı checklist'idir.

## 1. Otomatik teknik kontroller

- [x] HTTPS-only hosted origin validation API startup'ta enforce ediliyor.
- [x] Local file connector credential'ları AES-256-GCM ile encrypted-at-rest tutuluyor; staging/production yalnız OpenBao backend'i kabul ediyor.
- [x] Production API/worker OpenBao config, AppRole veya health secret okuma izni olmadan başlamıyor.
- [x] Global API rate limit + daha sıkı login rate limit var.
- [x] Tenant/public visibility RLS testleri gerçek PostgreSQL üzerinde CI'da çalışıyor.
- [x] Connector retry/backoff, reauthorization ve stale catalog gözlemi var.
- [x] Signed conversion callback verification var.
- [x] DB backup + isolated restore exercise CI'da çalışıyor.
- [x] `search_error`, `request_failed`, `queue_lag`, `catalog_stale`, `sync_failed`, `import_failed`, `outbox_publish_failed` gibi kritik olaylar dış operasyon alert sink'ine taşınabiliyor.
- [x] Production ortamında harici ops alert webhook + HMAC secret zorunlu.
- [x] Production compose contract CI'da render ediliyor; deploy script syntax CI'da doğrulanıyor.
- [x] Production release yalnız immutable 40-char commit SHA ile çalışıyor.
- [x] Normal deploy backup → forward migration → rollout → exact release readiness sırasını izliyor.
- [x] Rollback explicit eski image SHA'sına application rollback yapıyor; migration otomatik geri alınmıyor.
- [x] Production deploy exact release için başarılı `Staging hosted smoke` workflow kanıtı istiyor.

Yerel AES-256-GCM backend production kabulü değildir. OpenBao adapter ve Raft compose kodu vardır; gerçek staging policy, unseal, pilot plaintext backup temizliği ve recovery tatbikatı henüz kanıtlanmadı. [Issue #9](https://github.com/theOguz16/ShopAI/issues/9) açık kalır.

ÜRÜN-004 [operasyon ve migration kararındaki](follow-ups/urun-004-managed-secrets.md) staging kanıtı tamamlanmadan production kabulü verilmez. `0035_connector_secret_lifecycle.sql` ve `0036_connector_secret_backend.sql` migration'larını inceleyin; production DB migration'ı bu görevde yapılmaz.

## 2. GitHub `production` environment kurulumu — OPERATÖR GATE

Aşağıdakiler GitHub repository environment'ında gerçek değerlerle kurulmadan production workflow çalıştırılmamalıdır.

Environment variables:

- `PRODUCTION_API_ORIGIN`
- `PRODUCTION_WIDGET_ORIGIN`
- `PRODUCTION_HOST`
- `PRODUCTION_SSH_USER`
- `PRODUCTION_DEPLOY_PATH` (öneri: `/opt/shopai-production`)
- `PRODUCTION_ENV_FILE` (öneri: `/etc/shopai/production.env`)

Environment secrets:

- `PRODUCTION_SSH_PRIVATE_KEY`
- `PRODUCTION_SSH_KNOWN_HOSTS`

GitHub `production` environment'ında required reviewer kullanılması önerilir. İlk production deploy'dan önce bunu ayrıca doğrula.

- [ ] Production environment oluşturuldu.
- [ ] Required reviewer tanımlandı.
- [ ] SSH key minimum yetkili deploy kullanıcısına ait.
- [ ] `known_hosts` gerçek host key'den alındı; `StrictHostKeyChecking=no` kullanılmıyor.

## 3. Production host secret dosyası — OPERATÖR GATE

`PRODUCTION_ENV_FILE` root/deploy operator tarafından oluşturulur ve `chmod 600` olmalıdır. Deploy script group/world-readable dosyayı reddeder.

Minimum değişkenler:

```text
PRODUCTION_DATABASE_URL=...
PRODUCTION_REDIS_URL=...
PRODUCTION_API_ORIGIN=https://...
PRODUCTION_WIDGET_ORIGIN=https://...
PRODUCTION_ALLOWED_ORIGINS=https://chatgpt.com,...
PRODUCTION_RESOURCE_DOMAINS=https://...
PRODUCTION_REDIRECT_SIGNING_SECRET=...
PRODUCTION_AUTH_PILOT_CREDENTIALS='{"owner@example.com":"..."}'
PRODUCTION_OPENBAO_TLS_DIR=/secure/openbao/tls
PRODUCTION_OPENBAO_CA_CERT=/secure/openbao/tls/ca.crt
PRODUCTION_OPENBAO_API_ROLE_ID=...
PRODUCTION_OPENBAO_API_SECRET_ID_FILE=/secure/openbao/api-secret-id
PRODUCTION_OPENBAO_WORKER_ROLE_ID=...
PRODUCTION_OPENBAO_WORKER_SECRET_ID_FILE=/secure/openbao/worker-secret-id
PRODUCTION_OPS_ALERT_WEBHOOK_URL=https://...
PRODUCTION_OPS_ALERT_WEBHOOK_SECRET=...
PRODUCTION_CONVERSION_CALLBACK_SECRET=...
PRODUCTION_LOGIN_RATE_LIMIT_MAX=5
PRODUCTION_BACKUP_DIR=/secure/shopai-production-backups
```

- [ ] Production PostgreSQL staging'den fiziksel/mantıksal olarak ayrı.
- [ ] Production Redis staging'den ayrı.
- [ ] Production upload volume staging'den ayrı.
- [ ] Backup dizini production host üzerinde erişim kontrollü.
- [ ] DB sağlayıcısında günlük backup/PITR politikası doğrulandı.

## 4. Harici monitoring/alert receiver — OPERATÖR GATE

ShopAI şu header'larla JSON alert POST eder:

```text
x-shopai-alert-timestamp: <unix-ms>
x-shopai-alert-signature: sha256=<hex>
```

İmza input'u:

```text
HMAC_SHA256(secret, timestamp + "." + rawBody)
```

Receiver timestamp freshness kontrolü yapmalı ve replay'leri reddetmelidir. Önerilen paging kuralları:

- `search_error` / `request_failed`: 5 dakikada >=3 → page.
- `queue_lag`: tek olay → warning; 5 dakika devam ederse page.
- `catalog_stale`: aynı connection iki ardışık gözlem → page.
- `sync_failed`, `import_failed`, `outbox_publish_failed`, `scheduler_failed`: tek olay → page veya on-call warning.

- [ ] Receiver HMAC doğruluyor.
- [ ] Replay/freshness kontrolü var.
- [ ] Test alert gerçek on-call kanalına ulaştı.
- [ ] Alert sink outage'ı ShopAI request/job execution'ını durdurmuyor.

## 5. Staging → production release gate

Normal deploy:

1. Target SHA `main` üzerinde olmalı ve CI green olmalı.
2. Aynı SHA staging'e deploy edilir.
3. `Staging hosted smoke` workflow'u exact SHA ile success olmalı.
4. Production workflow `operation=deploy`, aynı `release_version`, başarılı staging `run id` ve `confirmation=PRODUCTION` ile çalıştırılır.
5. Workflow GHCR'a immutable SHA image push eder.
6. Production host backup alır.
7. Forward migration bir kez uygulanır.
8. API/worker/web/widget rollout edilir.
9. Local readiness + public HTTPS readiness exact release SHA doğrular.
10. Workflow URL'si release evidence olarak saklanır.

Rollback:

1. Daha önce başarıyla deploy edilmiş immutable SHA seçilir.
2. Production workflow `operation=rollback` ile çalıştırılır.
3. Target image GHCR'da yoksa fail closed olur.
4. Migration çalıştırılmaz/geri alınmaz.
5. Exact release readiness tekrar doğrulanır.

- [ ] En az bir staging deploy + exact smoke kaydı var.
- [ ] Production deploy workflow'u gerçek hostta bir kez başarıyla çalıştı.
- [ ] Ayrı bir eski release'e rollback rehearsal yapıldı.
- [ ] Rehearsal sonrası yeniden ileri release deploy edildi.

## 6. Legal/policy gate — DIŞ ONAY GEREKLİ

Repo'da başlangıç taslakları vardır:

- `docs/legal/privacy-policy-draft.md`
- `docs/legal/terms-of-service-draft.md`
- `docs/legal/merchant-pilot-agreement-draft.md`

Bunlar hukuki görüş değildir ve placeholder'lar tamamlanmadan yayınlanmamalıdır.

- [ ] Veri sorumlusu/şirket unvanı, adresi ve iletişim bilgileri dolduruldu.
- [ ] Uygulanacak hukuk/jurisdiction belirlendi.
- [ ] KVKK/GDPR kapsamı ve aydınlatma/başvuru süreci hukuk danışmanı veya yetkili işletme sahibi tarafından incelendi.
- [ ] Retention süreleri gerçek ticari sözleşmeyle eşleşiyor.
- [ ] Merchant'ın ürün/görsel kullanım izni ve attribution/conversion şartları imzalı sözleşmede yer alıyor.
- [ ] Privacy Policy ve Terms public HTTPS URL'de yayınlandı.
- [ ] Pilot merchant agreement gerçek merchant tarafından imzalandı.

## 7. Final production sign-off

TASK-021 ancak aşağıdaki üç grup birlikte tamamlanırsa **COMPLETE** sayılır:

1. Otomatik teknik kontroller green.
2. Operatör gate'leri gerçek infrastructure evidence ile tamamlanmış.
3. Legal/policy gate gerçek onaylarla tamamlanmış.

Şu an repo teknik olarak production deploy/rollback ve external alerting için hazır hale getirilebilir; fakat gerçek host/environment kurulumu, gerçek alert receiver doğrulaması ve legal sign-off dış bağımlılık olarak ayrıca kanıtlanmalıdır.
