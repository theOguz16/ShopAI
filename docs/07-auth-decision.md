# Kimlik ve oturum kararı — ÜRÜN-003

> **Durum: ÜRÜN-003 kod düzeyinde aşamalı olarak uygulandı, gerçek Auth0/HTTPS staging kabulü BEKLİYOR.** 0031+0032 migration, iki-client OIDC giriş/callback, verified-email ve issuer+subject kimliği, kanıtlı pilot claim, şifreli tek kullanımlık PKCE/nonce, opaque session/CSRF, logout-all, owner MFA/step-up ve hesap kapatma kodları branch üzerindedir. Test sağlayıcısı gerçek imzalı Auth0 tokenı değil doğrulanmış sağlayıcı çıktısını taklit eder. Gerçek recovery e-postası, MFA cihazı, HTTPS tarayıcı ve anonimleştirilmiş gerçek veride migrasyon kabulü yapılmadı. Pilot giriş kontrollü geçiş için açık, ÜRÜN-003 KISMİ / AÇIK.

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

## Uygulanan kod ve güvenli geçiş kapıları

1. Veri temeli: 0031 ve 0032 additive migration; mevcut kullanıcı UUIDleri, üyelikler ve pilot oturumları silinmez. Kimlik anahtarı doğrulanmış issuer + subject. E-posta eşleşmesi tek başına hesap birleştirmez.
2. OIDC: openid-client 6.8.4 Authorization Code + PKCE S256, state ve nonce doğrulamasına yönelik sunucu kodu; encrypted browser-bound, 5 dakika geçerli ve atomik tek kullanımlık callback. Sağlayıcı tokenları tarayıcıya aktarılmaz. Gerçek Auth0 imza/JWKS doğrulaması staging ortamında ayrıca sınanmalıdır.
3. Hesap ve oturum: Pilot credential kanıtı ve doğrulanmış e-posta sonrası transaction içinde eski UUIDye link; pilot session iptali; hashlenmiş OAuth cookie, idle/mutlak süre, revocation, CSRF+origin, backend membership ve owner MFA kontrolü. Entegrasyon testleri doğrulanmış sağlayıcı çıktısını mocklar.
4. Çıkış ve kapatma: logout-all session iptali; son owner için ownership transfer zorunluluğu. Auth0 SSO logout, recovery e-postası ve MFA cihazı dış ortamda ayrıca doğrulanmalıdır.
5. Kontrollü cutover (YAPILMADI): Gerçek Auth0 tenant, ayrı shopper/merchant client ID ve secrets, HTTPS callback/logout allowlist, MFA Action ve e-posta sağlayıcısı; anonimleştirilmiş gerçek veride migrasyon/UUID/üyelik mutabakatı, backup-restore, gerçek tarayıcı negatif testleri gerekir. Operatör ve kullanıcı doğrulaması olmadan AUTH_PILOT_LOGIN_ENABLED kapatılmaz veya pilot credentials kaldırılmaz.

Gerçek ortam kabul matrisi: [ÜRÜN-003 Auth0 staging kabulü](follow-ups/urun-003-auth0-staging-acceptance.md). ÜRÜN-016 Web/ChatGPT principal sürekliliği ve ÜRÜN-032 gerçek kullanıcı pilotu bu PR ile karşılanmış sayılmaz.
