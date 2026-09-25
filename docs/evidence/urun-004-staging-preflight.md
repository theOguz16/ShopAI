# ÜRÜN-004 — staging salt okunur preflight

24 Eylül 2026. Bu incelemede staging VDS'de deploy, restart, OpenBao init/unseal, DB migration, secret değişimi veya cleanup yapılmadı. Sunucu release'i `53dc32bbc333bfad40eff5c7ef32316cd3bd0cec`; API/worker/web/widget aynı image ID `sha256:aca84315b51b28eacb3dc62214cf1f7e0aec295f41dc8683769ff244b834c965` ile çalışıyor. Staging DB son migration'ı `0033_better_auth`. OpenBao container/image, private network, Raft volume, TLS/config/policy dosyaları ve uygulama OpenBao env alanları mevcut değil. `openbao.shopai.internal` VDS/API/worker içinde çözülmüyor.

## Disk envanteri ve kapı

| Gözlem | Değer |
| --- | --- |
| `df -h /` | 40 GB toplam, 32 GB kullanım, 6.4 GB boş, %84 dolu |
| `df -i /` | %29 inode kullanımı |
| `docker system df` | Images 21.58 GB; reclaimable 12.82 GB; build cache 4.017 GB fakat yalnız 13.98 MB reclaimable; volumes 1.645 GB, reclaimable 0 |
| Staging DB `pg_database_size` | 13,932,211 byte; bu metadata ölçümüdür, dump boyutu değildir |
| Mevcut küçük özel backup dizinleri | Yaklaşık 1.2 MB ve 264 KB; yeni yedek boyutu için güvenilir üst sınır değildir |
| Yerel OpenBao 2.7.0 image `Size` | 74,513,509 byte; VDS'ye image henüz çekilmedi |
| Çalışan ShopAI image Docker inspect `Size` | 271,962,807 byte; `docker image ls` sanal gösterimi yaklaşık 1.3 GB |

**Deployment kapısı: en az 8 GB boş alan, yeni build/pull ve staging DB yedeğinden hemen önce tekrar ölçülmeli; rollout ve snapshot provasında en az 2 GB boş kalmalı.** 8 GB, yeni ShopAI image/build geçici katmanları için yaklaşık 4 GB, OpenBao image + başlangıç Raft + geçici snapshot için yaklaşık 1 GB, staging DB dump için ölçülen 14 MB'ye karşı güvenli 0.5 GB ve 2 GB operasyon payı üzerinden muhafazakâr yuvarlamadır. Gerçek image/build ve Raft büyümesi kabul sırasında ölçülür. Mevcut 6.4 GB bu kapının **altında**; otomatik cleanup yapılmaz.

Container referansı olmayan eski `shopai-staging` image tag'leri inceleme adayıdır: `1459a5c`, `aa97377`, `e98e480`, `ab19e36`, `6f6d041`, `a3dea76`. `f9ae3b6` ve `cc858d3` yakın rollback geçmişi; `53dc32b` aktif release, `a8594cf` ise çalışan demo-refresh container'ı tarafından kullanılıyor. Image katmanları paylaşılabileceğinden silinince açılacak gerçek alan tag sanal boyutlarının toplamı değildir. Operatör önce her adayın rollback/backup değerini ve `docker system df -v` benzersiz reclaimable katmanını kontrol eder; **silme için ayrı açık onay** gerekir. Volume veya aktif image cleanup adayı değildir.

## Onay sonrası staging sırası

1. PR #61 exact SHA ve güncel main'i sabitle; `0034_generic_product_variants → 0035_connector_secret_lifecycle → 0036_connector_secret_backend` sırasını doğrula. SQL içerikleri yalnız numaralandırma için değişmedi. Staging DB'nin `0033` olduğu yeniden doğrulansın.
2. Disk kapısı geçince mevcut Compose/env/image ID'leri yedekle ve staging PostgreSQL `pg_dump` al; dump checksum ve izole restore okunabilirliğini doğrula. Snapshot ve unseal payları ayrı, VDS dışı güvenlik alanlarında kalmalı.
3. `openbao/openbao:2.7.0@sha256:71156a1c6623a5fa3f5e61b0c6a8ead0faf0df29a778339188443551995d1315` image'ını çek. OpenBao'yu ayrı container, private network, TLS ve kalıcı Raft volume ile başlat. Host portu/public ingress açma. `openbao.shopai.internal` private network alias'ı ve CA doğrulamasını test et.
4. Operatör özel oturumundan Shamir init/unseal yapar; root token/share değerleri uygulama container'ına, VDS kalıcı dosyasına, loga veya rapora yazılmaz. Staging KV v2 mount/health sentinel, declarative audit, staging API/worker dar policy ve ayrı AppRole'lar kurulur. Root token yerine ayrı off-host admin identity kurulur ve ilk root token revoke edilir. SecretID'ler ayrı read-only host dosyalarıyla dağıtılır.
5. OpenBao policy ayrımı ve provider readiness geçince exact-SHA ShopAI image'ı oluşturulur. Staging DB migration'ları `0034→0035→0036` sırayla uygulanır, sonra API/worker/web/widget güncellenir. Production secret veya migration kullanılmaz.
6. Kontrollü staging credential ile store/resolve, API/worker ayrımı, environment/merchant/connection izolasyonu, rotation ve failed-rotation rollback, revoke ve kuyruktaki job, audit, outage, restart/unseal, Raft snapshot/izole restore, file→OpenBao plan/apply/retry/rollback ve `--cleanup` dry-run kanıtlanır. Credential değerleri rapora alınmaz.

**Rollback sırası:** Uygulama secret yazmalarını durdur, etkilenen bağlantıların eski scoped-file sürümünü ve migration audit'ini doğrula, explicit `--rollback` ile DB reference'ı geri al; bu adım OpenBao health gerektirmez ve OpenBao kaydını pending-cleanup audit'inde bırakır. API/worker'ın file referansını çözmesi gerekiyorsa onaylı eski file-backend release/config'e dön; production runtime OpenBao-only politikasında otomatik file fallback yoktur. Sonra eski Compose/image'ı geri yükle, readiness ve worker çözümlemesini doğrula. Raft volume, snapshot ve emekli file'ları retention/inceleme bitmeden silme.

## 24 Eylül 2026 — preflight uygulaması ve düzeltmeler

Aynı gün operatör onayıyla preflight uygulandı; OpenBao init/unseal, DB migration, secret migration, staging deploy ve merge hâlâ uygulanmadı. Hiçbir secret/credential değeri bu kayda yazılmadı.

| Kapı | Sonuç |
| --- | --- |
| Disk (8 GB) | **PASS** — minimum güvenli cleanup sonrası `df -h`: 14 GB boş (40 GB toplam, %64) |
| OpenBao exact digest | **PASS** — `openbao/openbao:2.7.0` VDS'ye çekildi; `RepoDigests` beklenen `sha256:71156a1c6623a5fa3f5e61b0c6a8ead0faf0df29a778339188443551995d1315` ile birebir; container başlatılmadı |
| Backup off-VDS | **PASS** — custom-format `pg_dump` 410.772 byte; SHA-256 `f15edb8a3c8159cd17ca1dc87e5a402f85ddc8644f6c2b6b799f97f15844bd1e`; `/home/deploy/shopai-staging-backups/shopai-staging-20260924T182234Z.dump` olarak alındı, operatör workstation'ına kopyalandı ve checksum birebir doğrulandı |
| İzole restore | **PASS** — fresh PostgreSQL 17 üzerinde 33 migration + 29 public tablo; canlı staging migration sayısı (33) ile birebir |

Cleanup yalnız iki kalemde uygulandı: `docker builder prune -af` (4.017 GB, `docker system df -v` tamamını reclaimable gösteriyordu) ve release tarball'ı VDS'de kanıtlı beş eski `shopai-staging` imajı (`aa97377`, `ab19e36`, `e98e480`, `a3dea76`, `6f6d041` — her birinin tarball'ı `shopai-release-artifacts/` altında geri yükleme kanıtıdır). Çalışan release `53dc32b`, demo-refresh'in kullandığı `a8594cf`, tarballsuz `1459a5c`/`cc858d3`/`f9ae3b6`, tüm volume'ler, backup dizinleri ve woo-pilot kaynak kodu korunmuştur. Dangling image ve durmuş container yoktu.

Restore provası, dump'taki RLS/policy referanslarının `shopai`, `shopai_app`, `shopai_public`, `shopai_worker` rollerine bağımlı olduğunu gösterdi. `infra/restore.sh` artık eksik rolleri parolasız `NOLOGIN` olarak idempotent biçimde oluşturur (mevcut roller dokunulmaz), migration count yanına public tablo sayısı doğrulaması ekledi ve CI aynı koşuda fresh PostgreSQL instance'ında role bootstrap yolunu ayrıca prova eder. Bu düzeltme salt restore bağımlılığını karşılar; üretim login/grant politikasını değiştirmez.

Düzeltme: 24 Eylül operatör preflight raporundaki "IPC_LOCK gerekli" çıkarımı **yanlıştı**. OpenBao 2.0.0'dan itibaren mlock işlevi kaldırılmıştır; `disable_mlock` obsolete bir seçenektir ve 2.7.0'ın onu reddetmesi beklenen obsolete-option davranışıdır. OpenBao 2.7.0 mlock kullanmadığı için compose'a `cap_add: [IPC_LOCK]` eklenmedi, hiçbir ek Linux capability verilmedi ve `no-new-privileges` korundu. Buna karşılık OpenBao service'ine bounded log rotation eklendi (`driver: json-file`, `max-size: 10m`, `max-file: 5`): audit stdout akışı korunur, tek container'ın json log'u sınırlı kalır ve host Docker daemon config'i değiştirilmez. Aynı audit/log gereksinimi production rollout öncesinde `infra/production.compose.yaml` için de uygulanacaktır.

Deployment öncesi hâlâ açık: host'ta `/etc/shopai` TLS dizini, CA cert ve AppRole SecretID dosyalarının provision edilmesi, OpenBao init/unseal, KV mount/policy/AppRole kurulumu, `0034→0035→0036` migration ve secret migration.

## 25 Eylül 2026 — Faz 2 staging lifecycle kabulü PASS

Staging cutover ve ÜRÜN-004 lifecycle kabulü gerçek staging üzerinde tamamlandı (head `86f92b5…`): root token operatör AppRole kanıtından sonra revoke edildi; `0034→0035→0036` uygulandı (veri birebir korundu); tek legacy woo bağlantısı file→OpenBao migrate edildi (migrated=1); API/worker/web/widget OpenBao backend'e geçti; tenant izolasyonu (403/401/404), rotation 200, failed rotation 422, revoked ref 404/active 200, pre-revoke queued job fail-closed (`sync_failed`, payload'da credential yok), outage'ta rotation 500 fail-closed + web/widget 200, explicit rollback (provider-up ve provider-down + eski release app swap) restored=1, cleanup dry-run `eligible=0`, aktif credential exact-value log scan 0/0/0 kanıtlandı. Raft snapshot ve DB backup'ları off-VDS checksum doğrulamalı.

## 25 Eylül 2026 — 0037 legacy backfill

Faz 2 kabulünde saptanan blocker: `0035` mevcut legacy scoped-file state'i backfill etmediği için migration sonrası file/rotated historical satırı yok oluyor ve rollback version-slot collision'a düşüyordu. Uygulanmış `0035/0036` değiştirilmeden additive `0037_connector_secret_legacy_backfill` eklendi: `secret://` referanslı aktif/legacy bağlantılar için `file`/`version 1`/`active` historical satırını idempotent üretir (referans ve version-slot guard'ları; secret value yazılmaz; `source_connections` durumu dokunulmaz). Kanıt: gerçek pre-migration staging backup'ı (0033 seviyesi) izole PostgreSQL 17'ye restore edilip `0034→0035→0036→0037` zinciri manuel normalization olmadan çalıştırıldı; plan beklenen adayı gördü, script'in apply/rollback SQL sözleşmesi collision'sız, ikinci 0037 no-op. Regression testi `tests/integration/connector-secret-legacy-backfill.test.ts`. Destructive old-file cleanup 30-gün retention sonrası ayrı onaylı operasyon; snapshot schedule/encryption production operasyon follow-up'ıdır — ikisi de merge blocker değildir.
