# ÜRÜN-004 — OpenBao connector secret yaşam döngüsü

## Karar ve mimari

Production ve staging için tek provider **self-hosted OpenBao 2.7.0**. API, worker ve OpenBao ayrı container'lardır. OpenBao yalnız `shopai-<env>-secrets-net` private Docker networkünde dinler; host portu veya public ingress yoktur. API/worker `https://openbao.shopai.internal:8200` sabit hostname'ini ve operatörün sağladığı özel CA'yı kullanır. İleride ayrı VDS'ye taşınırken uygulama backend sözleşmesi korunur; DNS/routing ve TLS SAN yeni hedefe çevrilir. OpenBao Raft verisi kalıcı named volume'dadır. OpenBao barrier şifrelemesi Raft disk içeriğini şifreler; host disk şifrelemesi ayrıca önerilir. OpenBao 2.7 `mlock` desteği kaldırdığı için host swap kapalı veya şifreli olmalıdır. Tek node Raft HA değildir: VDS kaybı hizmet kesintisidir. OpenBao sunucusu, TLS, unseal, patch, snapshot ve audit işletimi ShopAI operatörünün maliyetidir.

Aynı VDS'nin root seviyesinde ele geçirilmesi halinde OpenBao ile ShopAI süreçleri aynı host güvenlik alanını paylaşır. Bu ilk pilot/production dağıtımı için bilinçli risk sınırıdır; host-root'a karşı bağımsız izolasyon iddiası yoktur. Daha güçlü izolasyon için OpenBao ayrı VDS/node'a taşınmalıdır.

İlk sürümde connection başına AppRole/policy açılmaz. Dört sabit policy yalnız kendi environment mount'undaki `data/health` veya `data/connectors/*` ve API için `metadata/connectors/*` yollarını kapsar. API AppRole create/read/update ve metadata delete; worker AppRole yalnız read alır. Staging ve production kimlikleri birbirinin mount'unda yetkisizdir. Bir API veya worker AppRole credential'ı ele geçirilirse o identity'nin **tüm environment prefix'indeki** yetkileri kullanılabilir; PostgreSQL/application scope kontrolü çalınan credential ile OpenBao'ya doğrudan erişimi sınırlamaz. Connection başına policy daha dar olurdu, ancak dinamik policy/control-plane operasyon yükü nedeniyle ilk sürümde ertelenmiştir. OpenBao ağ izolasyonu, kısa token TTL, SecretID rotation, audit ve uygulama kapsam kontrolü bu riski azaltır; ortadan kaldırmaz.

`secret://ONBOARDING_...` referansı değişmez. KV v2 mount `shopai-staging` veya `shopai-production` ve path `connectors/<merchant>/<connection>/<provider>/<opaque-id>` kullanılır. Deterministik scope yalnız isimlendirmedir; referans veya path tahmini yetki vermez. Secret payload içinde scope ve credential bulunur. PostgreSQL merchant, connection, provider, reference, backend, version, active/revoked ve audit metadata'sını tutar; credential value tutmaz. Worker PostgreSQL tenant/reference/active/backend kontrolünden sonra OpenBao'ya gider. API ve worker ayrı AppRole identity kullanır. API create/verify/revoke, worker read/resolve ve her ikisi health sentinel okuma gerektirir. Root token uygulama env'lerinde bulunmaz.

## Ortam ve fail-closed

| Ortam | Politika |
| --- | --- |
| local/test | Mevcut AES-256-GCM scoped `file` backend varsayılan; OpenBao açık seçilebilir. |
| staging | `openbao` zorunlu; `shopai-staging` mount, ayrı AppRole/TLS/snapshot. Production credential kullanılmaz. |
| production | Yalnız `openbao`; file/eksik config/yanlış mount/HTTP/başarısız AppRole veya health sentinel ile API ve worker başlamaz. API readiness aynı health okumasını yineler. Otomatik file fallback yoktur. |

OpenBao kesintisinde API secret işlemleri ve worker çözümlemesi başarısız olur. Önceden kuyruğa alınmış iş worker'ın DB aktiflik kontrolüne tabi kalır. Revoke önce DB'de atomik yapılır; OpenBao metadata silme başarısızsa DB yine erişimi keser ve operatör retry uyarısı alır. Çalışmakta olan dış connector HTTP isteği anında iptal edilemez.

## Bootstrap, policy ve unseal

Operatör özel CA ve `openbao.shopai.internal` SAN içeren sunucu sertifikasını hostta erişim kontrollü dosyalardan read-only mount eder; OpenBao container UID 100 TLS private key'i okuyabilmelidir. Staging ve production için KV v2 mount, health sentinel, ayrı AppRole ve audit device kurar. API/worker RoleID ayrı env'de; SecretID ayrı host dosyasında tutulur ve container'a read-only mount edilir. SecretID dosyası rotation'da atomik değiştirilir; adapter her işlemde dosyayı yeniden okuyup kısa ömürlü AppRole token alır. Token loglanmaz. AppRole SecretID kısa TTL/usage limit, dar CIDR ve operatör gözetiminde response wrapping ile dağıtılır. Root token yalnız bootstrap sırasında operatörün güvenli oturumunda kullanılır, sonra revoke edilir; repo, uygulama env'i veya kalıcı VDS dosyasına yazılmaz.

Version-controlled ACL dosyaları `infra/openbao/policies/` altındadır. KV v2 `data/` ve `metadata/` capability'leri ayrı tanımlanır: API `data/connectors/*` create/read/update ile yeni sürümü yazıp doğrular ve `metadata/connectors/*` delete ile revoke/rollback artığını kaldırır; worker `data/connectors/*` read dışında lifecycle yetkisi almaz. İki role de yalnız kendi mount'undaki exact `data/health` read verilir. `shopai-*/` veya `secret/*` gibi genel glob yoktur. OpenBao default policy verilmemelidir; AppRole `token_no_default_policy=true` ile oluşturulmalıdır. Dört role için role ID/SecretID ve policy ayrı tutulur. Gerçek staging üzerinde cross-environment 403, worker write/delete 403 ve API yalnız kendi mount'unda lifecycle doğrulanmalıdır. Uygulamanın PostgreSQL merchant/connection/provider kontrolü devam eder; OpenBao policy tek tek tenant izolasyonu sağlamaz.

Shamir unseal seçilir; restart sonrası operatör off-host saklanan threshold share'leri güvenli kanaldan girer. Unseal/recovery share'leri VDS üzerinde kalıcı saklanmaz ve Raft snapshot ile aynı yerde tutulmaz. Root token ve share'ler uygulama container'larına verilmez. Operatör tekrar unseal/readiness tatbikatını staging'de kanıtlamalıdır.

## Migration ve recovery

`scripts/migrate-connector-secrets.mts`: `plan → OpenBao write → OpenBao read-back verify → PostgreSQL transaction/reference switch`. `--apply` local/staging ile sınırlı; aynı active backend tekrar taşınmaz. DB yarışında geçici OpenBao kaydı temizlenir. `--rollback` yalnız scoped eski file sürümünü doğrulayarak DB active reference'ı geri alır; plaintext/unscoped pilot dosyaya otomatik rollback yoktur. `--cleanup` 30 gün retention sonrası aktif OpenBao secret'ı doğrulayan **dry-run**'dır ve dosya silmez. Ayrı `--cleanup --confirm-retired-file-deletion` emekli dosyayı siler. Filesystem unlink, fiziksel blok ve backup kopyalarının güvenli silinmesini kanıtlamaz. Production migration çalıştırılmaz.

Operatör düzenli `bao operator raft snapshot save` alır, snapshot'ı VDS dışındaki şifreli/erişim kontrollü depoya kopyalar ve retention uygular. Staging kabulü: kontrollü test secret oluştur, snapshot al, izole OpenBao restore ortamında unseal et, aynı `secret://` scope ile çözümlemeyi doğrula. Snapshot ve unseal share'leri ayrı güvenlik alanlarında kalır. Gerçek staging snapshot/restore henüz yapılmadı.

## Issue #9 kabul matrisi

| Kabul maddesi | Durum | Kanıt / eksik |
| --- | --- | --- |
| Production manager ile at-rest encryption | OPEN | OpenBao Raft/barrier compose ve adapter var; gerçek staging init, TLS, unseal, policy ve restore henüz kanıtlanmadı. |
| Server-side abstraction; browser'da credential/reference yok | PASS | Provider interface, API/worker inject ve mevcut response/integration testleri. |
| Hesap yeniden açmadan rotation/revocation | OPEN | PR #61 DB lifecycle ve OpenBao contract unit testi var; gerçek OpenBao staging rotation/revoke henüz çalıştırılmadı. |
| Merchant/provider/reference/actor audit | OPEN | PostgreSQL `connector_secret_audit` integration testi var; gerçek staging ve OpenBao audit device kabulü açık. |
| Log/error/analytics/queue'da credential yok | PASS | Generic provider errors, yalnız ID taşıyan queue ve mevcut redaction testleri. |
| Pilot file migration ve safe deletion planı | OPEN | Plan/apply/verify/rollback/explicit cleanup kodu var; staging rollout ve backup retention/silme kanıtı yok. |
| Production pilot backend ile fail-closed | PASS | API/worker env testleri, başlangıç ve readiness OpenBao health kontrolü, compose policy. |

**ÜRÜN-004 KISMİ / OPEN.** Environment-prefix policy kararı kodlandı; gerçek staging OpenBao kabulü, restart/unseal, Raft snapshot/izole restore ve migration/rollback/cleanup tamamlanmadan tüm zorunlu maddeler PASS değildir.

[İzole yerel OpenBao TLS/Raft/snapshot provası](../evidence/urun-004-openbao-local-rehearsal.md) gerçek staging kanıtı yerine geçmez.
