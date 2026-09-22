# ÜRÜN-003 — Auth0 kurulum, güvenli geçiş ve gerçek kabul kapısı

**Durum:** Kod ve CI kanıtı ile gerçek Auth0 / HTTPS staging kabulü farklıdır. Bu belge gerçek tenant veya gerçek kullanıcı testi yapıldığı iddiası değildir. `main` merge için ayrıca ürün sahibinin açık onayı gerekir.

## 1. Dış yapılandırma (secret'ları GitHub'a veya loglara yazma)

Auth0 tenant üzerinde **iki ayrı Regular Web Application** oluştur: shopper ve merchant. Her biri için Authorization Code Flow etkin, implicit/password grant devre dışı, Universal Login ve e-posta doğrulaması etkin; uygun verified-email provider bağlantıları ve Database Connection kurulsun. Her iki uygulamada ayrı, tam eşleşen HTTPS callback URL tanımlansın:

- Shopper: `https://<API_HOST>/v1/auth/oidc/callback/shopper`
- Merchant: `https://<API_HOST>/v1/auth/oidc/callback/merchant`

Allowed Web Origins / Logout URL alanlarına gerçek `https://<WEB_HOST>` origin'i koy. Auth0 Database Connection her iki uygulama için etkin olmalı; şifre sıfırlama e-posta sağlayıcısı ve gönderen domain gerçek alıcıyla sınanmalı. Auth0 tenant issuer'ı **tam olarak** `https://<AUTH0_TENANT>/` biçiminde HTTPS kullanılmalı. Staging ve production için ayrı tenant veya ayrı application / secret ve ayrı veritabanı kullan.

API runtime secret yöneticisine aşağıdaki değişkenleri gir. Değerlerini bu belgeye/PR'a ekleme:

```text
AUTH0_ENABLED=true
AUTH0_ISSUER=https://<AUTH0_TENANT>/
AUTH0_WEB_ORIGIN=https://<WEB_HOST>
AUTH0_TRANSACTION_KEY=<cryptographically random 32 bytes, standard base64>
AUTH0_SHOPPER_CLIENT_ID=<shopper-client-id>
AUTH0_SHOPPER_CLIENT_SECRET=<shopper-client-secret>
AUTH0_SHOPPER_REDIRECT_URI=https://<API_HOST>/v1/auth/oidc/callback/shopper
AUTH0_MERCHANT_CLIENT_ID=<merchant-client-id>
AUTH0_MERCHANT_CLIENT_SECRET=<merchant-client-secret>
AUTH0_MERCHANT_REDIRECT_URI=https://<API_HOST>/v1/auth/oidc/callback/merchant
AUTH0_DATABASE_CONNECTION=<Auth0 Database Connection name>
AUTH_PILOT_LOGIN_ENABLED=true
```

`AUTH0_TRANSACTION_KEY` sadece sunucuda tutulmalı; kaybı veya rotasyonu sırasında başlamış OIDC işlemleri süresi dolana kadar başarısız olur. HTTPS `MCP_PUBLIC_ORIGIN` API'nin tam origin'i, `MCP_ALLOWED_ORIGINS` ise web origin'i ve `https://chatgpt.com` dahil izinli origin'ler olmalı. Web build için `NEXT_PUBLIC_API_URL=https://<API_HOST>` kullan. Mevcut `DATABASE_URL`, `REDIS_URL`, `REDIRECT_SIGNING_SECRET` ve hosted deploy şifreleme değişkenleri aynen gereklidir. Gerçek kullanıcı e-postasını test fixture'larında tutma.

## 2. MFA (mağaza sahibi)

Auth0 tenant üzerinde merchant uygulamasına MFA policy uygula (TOTP veya WebAuthn) ve yeni owner'ların enrollment'ını zorunlu kıl. Auth0 Post-Login Action, başarılı MFA'nın kanıtını **imzalı ID Token** içine `amr: ['mfa']` veya `https://shopai.example/claims/mfa: true` şeklinde yalnızca gerçekten MFA gerçekleştiğinde eklemeli; Action olmadan MFA oturum yükseltmesi `mfa` kabul edilmez. `auth_time` son 5 dakika içinde değilse ayrıca step-up gerekir. Owner istekleri MFA olmadan 403 `MFA_REQUIRED`, hesap kapatma 403 `MFA_STEP_UP_REQUIRED` vermelidir. MFA kayıp cihaz, recovery ve reset işlemleri Auth0 tenant politikasıyla gerçek ortamda sınanmalıdır; yalnızca ayar sayfasının görünmesi kabul kanıtı değildir.

## 3. Pilot kimlik bağlama ve cutover

Veritabanı yedeği al, **anonimleştirilmiş gerçek veri kopyası** üzerinde 0031+0032 migration'ı ve rollback/yedekten geri dönüşü sınayıp satır sayıları, `users.id`, `memberships.user_id`, `saved_products` ve `product_alerts` referanslarını karşılaştır. Önce pilot kodunu bilen kullanıcı `/v1/auth/oidc/claim` ile kendi pilot hesabını ispatlar; ardından **aynı e-postanın Auth0'da doğrulanmış olması** ve `issuer + subject` doğrulaması gerekir. Yalnız e-posta benzerliği hesap birleştirme değildir. Mevcut kimliğe bağlı başka UUID varsa çakışmayı reddet; elle kanıtlı destek süreci olmadan birleştirme yapma. Pilot oturumları başarılı atomik bağlama işleminde iptal edilir, UUID ve üyelikler yerinde kalır.

Pilot kimlikleri / canlı oturumları kontrolsüz silme. Tenant ve staging kabulünden sonra pilot kullanıcılara duyuru yap, oturum geçişini ölç, geri alma planını hazırla; **ayrı ve açık operatör onayı** ile `AUTH_PILOT_LOGIN_ENABLED=false` yapılandır. Bu değişkeni kapatmak veritabanı kayıtlarını silmez. Takip eden adımda sadece yeterli doğrulama ve ayrı onayla eski pilot credentials secret'larını kaldır.

## 4. Dış kabul matrisi — gerçek kanıt girilene kadar BLOCKED

| Kabul | Kanıt / beklenen sonuç | Durum |
| --- | --- | --- |
| Auth0 giriş/kayıt | Yeni doğrulanmış e-posta ile gerçek Auth0 Universal Login + shopper/merchant callback | BLOCKED: tenant yok |
| Güvenlik | Yanlış issuer/audience, hatalı imza, expired token, yanlış state/nonce/PKCE, tekrar callback => reddedilir | BLOCKED: gerçek staging negatif test yok |
| E-posta | Doğrulanmamış e-posta reddedilir, recovery maili gerçek posta kutusunda doğrulanır | BLOCKED: Auth0/mail yok |
| Veri koruma | Pilot UUID, üyelik, kaydedilenler/alarmlar ve staging backup/restore birebir korunur | BLOCKED: anonimleştirilmiş gerçek veri yok |
| Oturum | HTTPS `__Host-` Secure/HttpOnly/SameSite, CSRF origin + token, inactivity / revoke / logout-all gerçek tarayıcı testi | BLOCKED: HTTPS staging yok |
| Yetki/MFA | owner/editor/viewer, shopper denied, tenant A→B denied; owner MFA + step-up gerçek cihaz testi | BLOCKED: tenant/MFA staging yok |
| Kapatma | aktif oturumlar iptal, owner ownership transfer önkoşulu, kayıt saklama gereği ayrı inceleme | BLOCKED: gerçek kullanıcı testi yok |

CI entegrasyon testlerindeki mock OIDC provider **imza/JWKS veya gerçek Auth0 hizmetini sınamaz**; test raporunda bu fark açıkça korunmalı. Güvenlik raporunda uygulama loglarının callback `code`, `state`, cookie, pilot kodu veya secret içermediğini doğrula. En son tüm dış kabul kayıtlarının tarihi, ortamı, test kullanıcısı için anonim kimlik ve gözlemi kanıt bağlantılarıyla yazılmalı; ancak ondan sonra ÜRÜN-003 tamamlandı denebilir.
