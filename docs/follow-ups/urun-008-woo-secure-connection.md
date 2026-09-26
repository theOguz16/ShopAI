# ÜRÜN-008 — WooCommerce güvenli bağlantı (plugin pairing) yaşam döngüsü

## Karar ve mimari

Merchant, WooCommerce mağazasını ShopAI'a iki yolla bağlayabilir:

1. **Önerilen: plugin pairing (ÜRÜN-008).** Merchant dashboard'da mağaza
   adresini girer, ShopAI kısa ömürlü tek kullanımlık bir pairing kodu üretir.
   Mağazanın WordPress yöneticisi ShopAI Connector eklentisinde bu kodu girer;
   eklenti okuma yetkili bir WooCommerce REST API anahtarı üretir ve anahtarı
   doğrudan (sunucu → sunucu) ShopAI'ın complete endpoint'ine POST'lar.
   Raw credential tarayıcıya hiç ulaşmaz.
2. **Mevcut: manuel API anahtarı** (`POST /v1/merchants/:id/onboarding/woocommerce/connect`).
   ÜRÜN-004/005/006 kabul kanıtlarının dayandığı mevcut sözleşme korunur;
   dashboard'da "Alternatif" olarak sunulur. Trendyol onboarding aynı formu
   paylaşır ve değişmemiştir.

Repo'da ÜRÜN-008 öncesinde bir ShopAI WordPress eklentisi veya pairing
protokolü yoktu ("plugin" provada gerçek WooCommerce + wp-cli idi). Bu nedenle
protokol bu task ile tanımlandı ve mevcut connection lifecycle'ına
(`source_connections`, `connector_secrets`, OpenBao managed backend) ekleme
yapılarak kuruldu; ikinci bir paralel onboarding altyapısı icat edilmedi.

## Pairing yaşam döngüsü ve tehdit modeli

- `POST /v1/merchants/:merchantId/connections/woocommerce/pairing`
  (owner/editor, CSRF + same-origin): normalize edilmiş store URL ile pairing
  satırı oluşturur. Token = 32 rastgele bayt (base64url, 43 karakter); DB'de
  yalnız SHA-256 hash'i (`connection_pairings.token_hash`) tutulur. TTL
  `PAIRING_TOKEN_TTL_MINUTES` (varsayılan 15 dk, merkezi env config).
- Pairing state: `pending → consumed | expired | rejected`; merchant,
  initiating user, provider (yalnız `woocommerce`), store URL ve expiry ile
  bound'dur.
- `POST /v1/connectors/woocommerce/pairings/complete`
  (`x-shopai-pairing-token` header'ı, gövdede site kimliği + credential):
  hash eşleşmesi, `pending` durumu ve expiry kontrol edilir; siteUrl ve
  credentials.storeUrl normalize edilerek pairing'in store URL'siyle
  karşılaştırılır (farklı mağazaya taşıma reddedilir).

Tehditler ve karşılıklar:

| Tehdit | Karşılık |
| --- | --- |
| Token replay | Tek kullanım: consume, connection activation ile aynı transaction'da; ikinci kullanım `PAIRING_INVALID` + `pairing_rejected(replay)` audit |
| Token brute force / hashr'sız saklama | 256-bit rastgele token; DB'de SHA-256 hash |
| Pairing'i başka merchant'a taşıma | Complete endpoint'inde merchant parametresi yok; merchant bağı yalnız pairing satırıdır |
| Farklı mağazaya pairing kullanımı | siteUrl + credentials.storeUrl normalize edilip pairing.storeUrl ile eşitliği zorunlu |
| Yetkisiz WP kullanıcısı | Eklenti `manage_woocommerce` capability + nonce + kullanıcı başına 5 deneme/10 dk rate limit; API tarafı token zorunluluğu |
| Statik production secret | Eklenti içinde ShopAI secret'ı gömülü değildir; API adresi de pairing talimatıyla girilir (statik test ile denetlenir) |
| Credential sızıntısı | Token URL'de değil header'da; credential yalnız complete gövdesinde; API log redaction (`req.body.credentials`, `req.headers.x-shopai-pairing-token`); DB/audit/queue payload taramaları testle kanıtlanır |

## Secret handoff ve OpenBao

Activation sırası (complete endpoint):

1. Pairing doğrula (hash, status, expiry)
2. Store identity doğrula (siteUrl + credentials.storeUrl normalize eşleşmesi)
3. Credential doğrula (Woo connector `validate()` — `GET /wp-json/wc/v3/products?per_page=1`
   + para birimi okuması; salt-okunur)
4. OpenBao managed secret yaz (`createScoped`, scope = merchant + connection + provider)
5. Read-back doğrula (`resolveScoped` kanonik karşılaştırma)
6. DB activation (tek `withTenant` transaction: connection + `connector_secrets`
   v1 + ownership + sync progress + pairing consume + audit)
7. İlk sync kuyruğa alınır (yalnız yeni bağlantı; worker ilk canlı sync'te
   `pending → active` geçirir — mevcut lifecycle sözleşmesi)

Herhangi bir adım başarısız olursa aktif connection oluşmaz; secret yazımı
sonrası hata olursa secret `remove` ile geri alınır ve transaction rollback
olur (yarım active connection bırakılmaz). Retry idempotent'tir: pairing
`pending` kaldığı sürece yeni deneme yeni referans üretir.

Reconnect (aynı merchant + aynı normalize store URL) mevcut connection'ı
yeniden kullanır: yeni referans doğrulanıp OpenBao'ya yazıldıktan sonra tek
transaction'da eski secret `rotated`, yeni `connector_secrets` satırı (v+1)
`active` olur, `credentialsRef` değişir. Doğrulama başarısızsa hiçbir switch
olmaz; eski aktif referans çalışmaya devam eder.

Disconnect `DELETE /v1/merchants/:merchantId/connections/:connectionId`
(owner **ve editor** — ÜRÜN-008 ile editor'a açıldı): connection `revoked`,
aktif secret satırı `revoked`, OpenBao metadata silinir (post-commit),
audit yazılır. Worker scheduler revoked/inactive connection için sync
başlatmaz; in-flight sync de pre-flight kontrolüyle kesilir. Yeniden bağlama
sonradan pairing ile mümkündür.

## Store URL güvenliği (SSRF) ve normalizasyon

- Tüm Woo istekleri `createPublicConnectorFetch` üzerinden gider: yalnız
  HTTPS, userinfo reddi, `localhost/.localhost/.local/.internal` blocklist,
  DNS çözümlemesi sonrası tüm adreslerin public olması, çözümlenen IP'ye
  pinning (DNS rebinding koruması), `redirect: 'manual'` — redirect takip
  edilmez, her hop yoktur; 3xx doğrulama hatası sayılır.
- Local integration/rehearsal için **explicit test-only allow mekanizması**
  eklendi: `createPublicConnectorFetch(lookup, requester, { allowHosts })`.
  Yalnızca provası çalıştıran test dosyası `SHOPAI_WOO_REHEARSAL=1` iken
  kendi fetcher'ını allowlist ile kurar; API/worker üretim kodu hiçbir koşulda
  allowlist geçmez ve env tabanlı fallback yoktur.
- `normalizeConnectorStoreUrl`: scheme HTTPS zorunlu, hostname lowercase,
  `:443` atılır, trailing slash ve query/fragment atılır, path korunur
  (subdirectory install'ları ayrı kalır). Equivalence kümesi
  `(provider, store_url)` partial unique index'i
  (`source_connections_active_store_unique`, yalnız aktif bağlantılar) ile
  birleştirilir: aynı mağazanın iki merchant tarafından sessizce
  sahiplenilmesi imkânsızdır; çakışma `409 STORE_OWNERSHIP_CONFLICT` olarak
  explicit üretilir. Cross-tenant ön kontrol RLS'i aşmak için düz
  transaction'da yapılır; nihai garanti index'tedir (23505 → 409 + audit).

## Rol yetkilendirmesi

- Pairing oluşturma, credential test/connect, rotate: owner/editor
  (`requireRole`, owner için mevcut MFA kuralı korunur).
- Connection listeleme: owner/editor/viewer.
- Disconnect/revoke: owner/editor (ÜRÜN-008 ile).
- Shopper `client_kind` tüm merchant connection uçlarından 403 ile elenir
  (mevcut `requireRole` davranışı, testle kanıtlanır).
- Browser mutation'ları global CSRF hook'una tabidir (`x-shopai-csrf` +
  allowlist origin); plugin→ShopAI çağrısı kimliksiz olduğundan CSRF hook'tan
  muaftır, kimliğini pairing token'ından alır.

## Audit

`connection_audit` (0040): `pairing_created`, `pairing_consumed`,
`pairing_rejected` (detail.reason: expired/replay/store_mismatch/
store_conflict), `connection_created`, `validation_failed`,
`connection_reconnected`, `connection_secret_rotated`, `connection_revoked`.
Her satır actor (user id / `woocommerce_plugin`), merchant, provider,
connection (null olabilir), result (success/failure), detail, correlationId
ve timestamp taşır; secret değerleri asla yazılmaz. `connector_secret_audit`
(ÜRÜN-004) ayrıca aynen çalışmaya devam eder. RLS: yalnız `shopai_app`
tenant policy'si; `shopai_worker` ve `shopai_public` erişimi yok.

## Migration

`0040_woocommerce_pairing.sql` provisional slotudur; `0039` ÜRÜN-007'nin
paralel rezervasyonudur. Merge sırasına göre final review'da numaralar
contiguous olacak şekilde yeniden düzenlenir. Migration additive'dir;
`source_connections`'a `store_url`, `store_name`, `connected_via`
(default `dashboard_credentials`) kolonları ekler — mevcut pilot bağlantıları
etkilenmez. Production/staging DB'ye uygulama bu task kapsamında yapılmaz.

## ÜRÜN-009'a devredilen maddeler

Bu task aşağıdaki ÜRÜN-009 kabul maddelerini bilinçli olarak kapatmaz:

- Woo currency-settings okuma yetkisinin gerçek mağazada kanıtı
- Varyanta özgü satın alma URL'sinin doğru varyanta açıldığının kanıtı
- Genel Woo katalog doğruluğu (özellik, görsel, kategori, silme sync'i,
  iki mağaza izolasyonu)

ÜRÜN-008 yalnız "bu credential bu store'a güvenli şekilde bağlanabiliyor mu?"
sorusunu yanıtlar: pairing sonrası credential, hedef store'a karşı salt-okunur
server-side istekle doğrulanır; doğrulama başarısızsa bağlantı aktif olmaz.

## Kabul matrisi (teknik)

| Kabul maddesi | Durum | Kanıt |
| --- | --- | --- |
| Owner/editor pairing oluşturur, viewer/shopper oluşturamaz | PASS | `tests/integration/woocommerce-pairing.test.ts` 1–4 |
| Pairing TTL, expiry, replay, merchant binding | PASS | aynı dosya 5–7 |
| Plugin token/capability/nonce koruması | PASS | aynı dosya 8 + `tests/woocommerce-pairing-plugin.test.ts` |
| Geçerli pairing → connection + secret + kuyruk | PASS | 9, 12, 13 |
| Geçersiz credential → aktif connection yok | PASS | 10 |
| Raw credential response/DB/log/queue'da yok | PASS | 9, 11, 12, 24 |
| OpenBao referansı ile çalışır | PASS | 13 (recording backend; gerçek backend ÜRÜN-004 entegrasyon testleriyle aynı sözleşme) |
| Tenant izolasyonu | PASS | 14 + `tests/integration/tenant-isolation.test.ts` |
| Store ownership conflict | PASS | 15 |
| Reconnect rotate / failed reconnect koruması | PASS | 16, 17 |
| Disconnect revoke + worker engeli | PASS | 18, 19 |
| SSRF private/loopback + redirect kaçışı | PASS | 20, 21 + `tests/connector-target-policy.test.ts` + `tests/connector-target-safety.test.ts` |
| URL normalizasyonu duplicate üretmez | PASS | 22 + `tests/store-url.test.ts` |
| CSRF zorunlu | PASS | 23 |
| Audit actor/merchant/connection var, secret yok | PASS | 24 |
| `pnpm check` + tüm integration suite | PASS | branch head'de çalıştırıldı (bkz. PR) |

Kalan engeller: gerçek WooCommerce mağazasıyla staging üzerinde manuel
pairing provası (eklenti zip kurulumu dahil) ÜRÜN-009 gerçek katalog kabulüyle
birlikte yapılacaktır; bu, ÜRÜN-008 teknik kabulünün blocker'ı değildir.
