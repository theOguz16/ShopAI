# ÜRÜN-004 — izole yerel OpenBao provası

24 Eylül 2026. Bu kayıt **gerçek staging kabulü değildir**; yalnız test credential ve geçici yerel Docker volume kullanıldı. Production verisi/credential'ı kullanılmadı.

- `openbao/openbao:2.7.0` image digest `sha256:71156a1c6623a5fa3f5e61b0c6a8ead0faf0df29a778339188443551995d1315` çekildi. TLS listener, Raft storage ve Shamir seal ile `Initialized=true`, `Sealed=false`, `Version=2.7.0`, `Storage Type=raft` doğrulandı.
- 2.7.0 `disable_mlock` ayarını reddettiği için config düzeltildi. Named Raft volume'ün UID 100 OpenBao kullanıcısına ait olması gerektiği canlı startup'ta görüldü; Compose'a tek seferlik volume ownership init servisi eklendi.
- `shopai-test` KV v2 mount ve health sentinel oluşturuldu. Yalnız `shopai-test/data/health` exact path read yetkili test AppRole ile application adapter TLS üzerinden health okudu: PASS. Root token uygulama adapter'ına verilmedi.
- `bao operator raft snapshot save` ile 19.993 bayt test snapshot'ı alındı. İkinci, ayrı local Raft volume'ünde `snapshot restore -force` sonrası node sealed oldu; kaynak test unseal share'iyle yeniden açıldı ve restore edilmiş test kaydı HTTP 200 ile okundu: PASS.
- İki geçici OpenBao container, iki Raft volume, snapshot, test TLS dosyaları ve test init/root/unseal materyali yerel provanın sonunda silindi. Hiçbir credential değeri veya share bu kanıta yazılmadı.

Açık: gerçek staging VDS'de ayrı mount/role/policy, API/worker lifecycle, outage, migration/rollback, restart/unseal ve snapshot/restore kabulü yapılmadı.
