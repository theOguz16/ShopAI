# ÜRÜN-004 — izole yerel OpenBao provası

24 Eylül 2026. Bu kayıt **gerçek staging kabulü değildir**; yalnız test credential ve geçici yerel Docker volume kullanıldı. Production verisi/credential'ı kullanılmadı.

- `openbao/openbao:2.7.0` image digest `sha256:71156a1c6623a5fa3f5e61b0c6a8ead0faf0df29a778339188443551995d1315` çekildi. TLS listener, Raft storage ve Shamir seal ile `Initialized=true`, `Sealed=false`, `Version=2.7.0`, `Storage Type=raft` doğrulandı.
- 2.7.0 `disable_mlock` ayarını reddettiği için config düzeltildi. Named Raft volume'ün UID 100 OpenBao kullanıcısına ait olması gerektiği canlı startup'ta görüldü; Compose'a tek seferlik volume ownership init servisi eklendi.
- `shopai-test` KV v2 mount ve health sentinel oluşturuldu. Yalnız `shopai-test/data/health` exact path read yetkili test AppRole ile application adapter TLS üzerinden health okudu: PASS. Root token uygulama adapter'ına verilmedi.
- `bao operator raft snapshot save` ile 19.993 bayt test snapshot'ı alındı. İkinci, ayrı local Raft volume'ünde `snapshot restore -force` sonrası node sealed oldu; kaynak test unseal share'iyle yeniden açıldı ve restore edilmiş test kaydı HTTP 200 ile okundu: PASS.
- İki geçici OpenBao container, iki Raft volume, snapshot, test TLS dosyaları ve test init/root/unseal materyali yerel provanın sonunda silindi. Hiçbir credential değeri veya share bu kanıta yazılmadı.

24 Eylül'deki ek yerel policy provasında `openbao/openbao:2.7.0` geçici dev-mode container'ında ayrı `shopai-staging` ve `shopai-production` KV v2 mount'ları açıldı. Repo'daki dört ACL dosyası OpenBao tarafından kabul edildi. `token_no_default_policy=true` ile dört ayrı AppRole oluşturuldu. API'nin kendi environment'ında write ve metadata delete, worker'ın read işlemi geçti. Worker write/delete, staging → production ve production → staging read/write denemeleri reddedildi. Bu prova ACL davranışını doğrular; dev-mode nedeniyle TLS/Raft ve gerçek staging kabulü olarak sayılmaz. Geçici container ve yalnız test credential'ları silindi.

Açık: gerçek staging VDS'de ayrı mount/role/policy, API/worker lifecycle, outage, migration/rollback, restart/unseal ve snapshot/restore kabulü yapılmadı.
