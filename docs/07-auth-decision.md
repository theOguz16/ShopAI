# Kimlik ve oturum kararı — ÜRÜN-003

> **Durum: aşamalı geçiş, henüz kabul edilmedi.** Bu belge hedef mimariyi ve mevcut pilotun gerçek durumunu ayırır. `0031_auth0_identity_foundation.sql` yalnız geriye uyumlu şema kurar; Auth0 girişi, MFA, session enforcement, kullanıcının sahiplik kanıtı ve pilot girişini kapatma henüz uygulanmış değildir. Gerçek staging/production kimlik geçişi yapılmış gibi yorumlanamaz.

## Geçerli pilotun davranışı (tarihsel, henüz kaldırılmadı)

İlk pilotta harici kimlik sağlayıcısı yerine DB destekli opaque session vardır. Her davet kodu `AUTH_PILOT_CREDENTIALS` secret'ında tek bir normalize e-postaya bağlıdır; ortak mağaza kodu yoktur. API e-posta ve kodu birlikte sabit zamanlı karşılaştırmayla doğrulamadan kullanıcı/oturum oluşturmaz. Yanlış e-posta ile başka bir kullanıcıya ait geçerli kod aynı `INVALID_CREDENTIALS` yanıtını verir. `sessions` tablosunda ham değer değil SHA-256 özeti tutulur. Mevcut uygulama **24 saat** TTL, `shopai_session` cookie'si (`HttpOnly`, `SameSite=Lax`, `Path=/`; staging/production'da `Secure`) kullanır. Bunlar aşağıdaki yeni hedef politikanın uygulanmış olduğu anlamına gelmez.

Login gövdesi strict şemayla doğrulanır: e-posta en çok 254, pilot kodu 16–256 karakterdir; hatalı tür/ek alan `INVALID_INPUT`/400 döndürür. Genel API 60/dakika, login IP başına varsayılan 5/dakika ile sınırlandırılır; bu limit şu an çoklu-instance/hesap bazlı koruma kanıtı **değildir**. Panel 401 aldığında relative `returnTo` kullanır. Pilot login parola kurtarma, doğrulanmış e-posta veya MFA sağlamaz.

Pilot ilk mağaza kurulumunda kullanıcı `/v1/setup/merchant` ile tek mağaza oluşturabilir. `owner` üyelik/bağlantı; `editor` katalog/bağlantı; `viewer` okuma yetkisini korur. Rol her yönetim isteğinde backend üyeliğinden yüklenir; istemcinin merchant ID/rolü tek başına yetki vermez.

## Sabitlenen hedef mimari

- Tek kimlik sağlayıcısı **Auth0**, aynı tenant'ta iki ayrı OIDC client: `shopper` ve `merchant`. Auth0 Universal Login kayıt, parola doğrulama/kurtarma, e-posta doğrulama ve MFA'yı sağlar. ShopAI parola tutmaz veya yeni parola sıfırlama sistemi geliştirmez.
- Backend confidential web client, Authorization Code + PKCE **S256**, `state`, `nonce`, kısa ömürlü ve tek kullanımlık giriş işlemi. Kütüphane: bakım alan [`openid-client` v6](https://github.com/panva/openid-client); sürüm ve lockfile gerçek uygulama PR'ında sabitlenecek. Callback `openid-client` ile imza/issuer/audience/expiry/state/nonce doğrular; `email_verified !== true` olduğunda session çıkarmaz. HTTP redirect URI, state ve browser-binding birebir karşılaştırılır. Web/client tarafına IdP access veya refresh token verilmez.
- OIDC sonrası ayrı bir JWT/refresh sistemi yerine PostgreSQL opaque ShopAI session devam eder. 32 byte rastgele değer; DB'de yalnız SHA-256. Üretimde `__Host-shopai_session; Secure; HttpOnly; SameSite=Lax; Path=/` ve `Domain` yok. Yerel HTTP için ayrı isim. Mutlak 12 saat, shopper idle 30 dakika, merchant idle 15 dakika; hassas işlemde son 5 dakikada yeniden doğrulama. Logout ve logout-all server-side iptal; Auth0 oturumunu kapatmak ile ShopAI oturumunu iptal etmek ayrı işlemlerdir.
- Kimlik anahtarı **doğrulanmış issuer + subject**; e-posta tek başına kullanıcı upsert/merge anahtarı değildir. `users.id`, mevcut FK'ler, üyelikler, kataloglar ve geçmiş kayıtlar korunur. Auth0 doğrulanmış e-posta mevcut pilotla çakışırsa önce davet-kodu/sahiplik kanıtı ve transaction gerekir; kanıt yoksa otomatik yeni/bağlı mağaza yetkisi verilmez.
- `owner/editor/viewer` Auth0 claim'lerine taşınmaz; merchant üyeliği ve tenant RLS PostgreSQL'de backend tarafından kontrol edilir. Shopper'a otomatik mağaza açma, üye ekleme veya sahiplik verilmez. Owner için MFA ve yönetim step-up backend kanıtı ile zorunlu, yalnız Auth0 kullanıcı ayarına bakmak yeterli değildir.
- Cookie kullanılan durum değiştirici route'larda merkezi CSRF savunması (token + kesin origin kontrolü), HTTPS ve izinli CORS gerekir. Origin yoksa körlemesine güvenli sayılmaz; server-to-server çağrı ayrı mekanizmaya bağlıdır. Güvenlik logları code, cookie, token, parola veya MFA sırrı içermez.

## Sağlayıcı maliyeti ve dış bağımlılıklar

[Auth0 resmi fiyatlandırması](https://auth0.com/pricing), **22 Eylül 2026 kontrolü**: Free sayfası 25.000'e kadar aylık aktif kullanıcı, Essentials B2C örneği 500 MAU için aylık **$35**, Professional örneği 500 MAU için aylık **$240** gösteriyor; B2B/ek özellik, kullanım, vergi ve sözleşme koşullarına göre toplam değişir. Essentials 'Pro Multi-Factor Authentication', Professional 'Enterprise Multi-Factor Authentication' listeler. **Bu bilgi kullanıcı tenant'ının planını, OTP/TOTP veya WebAuthn/FIDO2 faktör yetkisini kanıtlamaz.** Tenant oluşturulunca gerçek plan/faktör, iki uygulama, Auth0 Actions/log erişimi, custom domain ve üretim e-posta teslimi ayrı ayrı gözlenmelidir. Test veya varsayılan Auth0 e-posta gönderimi üretim teslim kabulü değildir. Bütçe onayı olmadan ücretli plan satın alınmaz.

Development, staging ve production için ayrı uygulama kimlikleri/secrets, tam callback/logout allowlist'leri, güvenli secret store ve HTTPS gerekir. `issuer`, client ID, client secret ve redirect URI örnekleri gerçek credential ile dokümana/PR'a koyulmaz. Auth0 tenant, iki client, ücretli MFA kapsamı ve üretim e-posta sağlayıcısı **henüz doğrulanmadı**.

## Tehdit modeli ve zorunlu kontroller

| Tehdit | Kontrol / doğrulama |
|---|---|
| Login CSRF, code interception, callback replay | Rastgele state+nonce, S256 PKCE, tarayıcı bağlama, tek kullanımlık TTL, eşzamanlı tek-consumer işlem. |
| Sahte IdP/token, yanlış client | Discovery/JWKS üzerinden imza, tam issuer + client audience, süre/nonce, e-posta doğrulaması; fail closed. |
| Pilot hesabı ele geçirme | E-posta eşleşmesiyle birleştirme yok; doğrulanmış IdP kimliği + geçerli pilot davet kanıtı + atomik link, kayıp kod için denetimli recovery. |
| Session fixation, replay, çalınmış cookie | Yeni 32 byte token, DB SHA-256, `__Host-`/Secure/HttpOnly, mutlak/idle TTL ve revoke kontrolü; logout-all. |
| Shopper'dan owner'a yetki yükseltme | Backend membership + tenant RLS + doğrulanmış MFA/step-up; client-supplied role/merchant id kullanılmaz. |
| CSRF/open redirect | State-changing route'lar için token veya eşdeğer güçlü koruma, kesin origin, yalnız güvenli uygulama içi returnTo. |
| Gizli veri ifşası/IdP kesintisi | Redacted audit ve operasyon alarmı; Auth0 sorununda pilot'a otomatik geri dönüş yok. |
| Hesap kapatma/son owner | Önce owner transferi/mağaza kapama, yeni login engeli, bütün oturumların iptali, ayrı kişisel veri ve ticari retention kuralları. |

## Geriye uyumlu veri geçişi ve kapılar

1. **Phase 1 — şema (bu PR):** `0031_auth0_identity_foundation.sql`, Drizzle kimlik/işlem/audit modelleri ve izolasyon testi. Pilot kullanıcıları `account_status='pilot'` olarak kalır. `email_verified_at` NULL'dır. Mevcut sessions verisi silinmez, politika sütunları yalnız hazırlanır. `user_identities` ve diğer yeni tablolar public DB rolüne kapalıdır. Yeni MFA/TTL sütunları mevcut handler tarafından **henüz enforce edilmez**.
2. **Phase 2 — backend:** `openid-client` bağımlılığı ve lockfile, iki Auth0 client, doğrulanan start/callback, server-only token exchange, encrypted PKCE transaction store, session rotation, `logout-all`, CSRF, single-use pilot claim ve denetimli audit. Yeni kullanıcı başlangıcında email çakışması otomatik merge değil kanıt kapısıdır. Gerçek code/token/PKCE materyali loglanmaz.
3. **Phase 3 — web/merchant:** Universal Login ve doğrulama UX, ayrı shopper/merchant girişleri aynı ShopAI user ID, MFA/step-up, mağaza daveti, session yönetimi, hesap kapama. Tenant testleri ve eski `owner/editor/viewer` semantiği korunur.
4. **Phase 4 — kontrollü cutover:** Anonimleştirilmiş gerçek DB kopyasında migration + çift kimlik/race testleri, kullanıcı/üyelik/merchant/bağlantı sayısı ve FK mutabakatı, yedek/restore deneyi; Auth0 staging HTTPS tarayıcı E2E, üretim e-postası ve owner MFA. Operatör pilot secret'larını kaldırır; yeni pilot login kapanır, eski session'lar iptal edilir. Rollback eski güvensiz login'i açmaz. Dış kabul kanıtları olmadan ÜRÜN-003 kapatılmaz.

Mevcut pilot erişimini kaldırma işlemi bu PR'da **yapılmaz**: yetkili operatör ilgili credential'ı güvenli secret store'dan kaldırmalı, eşleşen kullanıcı session'larını aynı bakım işleminde iptal etmeli, eski cookie ile `/v1/auth/session` ve yönetim route'larında 401'i doğrulamalıdır. Gerçek e-posta/kod SQL veya shell geçmişine yazılmaz. Sadece üyeliği silmek login'i iptal etmez; sadece session silmek de pilot kodunu geçersiz kılmaz.

**İlgili belgeler:** [kanonik durum](06-implementation-status.md), [hesap bağlama / ÜRÜN-016](follow-ups/task-024-account-linking.md), [production readiness](production-readiness.md). Bu aşama ÜRÜN-016 Web/ChatGPT OAuth principal sürekliliğini, ÜRÜN-018 gerçek teslimi veya ÜRÜN-032 gerçek kullanıcı pilotunu karşılamaz.
