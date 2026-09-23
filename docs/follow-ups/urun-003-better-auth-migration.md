# ÜRÜN-003 — Better Auth geçiş kaydı

Durum: **Kısmi / açık**. Ürün kararı Better Auth. Auth0 giriş kodu, bağımlılığı, arayüzü ve Compose değişkenleri kaldırıldı. `0031`/`0032` migration geçmişi geriye dönük uyumluluk için korunur; bu eski tasarımın hâlâ çalıştığı anlamına gelmez. Better Auth feature flag varsayılan kapalıdır; pilot giriş varsayılan açıktır. Auth0 ile giriş yapan ortamlar Better Auth secret ve servis kurulmadan yeni giriş kabul edemez. Mevcut uygulama oturumlarının çerez adı uyumluluk için korunmuştur; oturum süresi bitince yeniden giriş gerekir. Bu kayıt teknik testleri gerçek müşteri kabulünden ayırır.

| İş | Bağımlılık | Tamamlanma kanıtı |
|---|---|---|
| Ayrı auth şeması ve paket | Better Auth 1.7.5, PostgreSQL | `0033_better_auth.sql` journal'a eklendi; staging yedeğinin izole yerel restore provası ve 0031–0033 migration'ları geçti. Migration staging DB'ye uygulandı; production DB'ye uygulanmadı. |
| Hesap bağlama | Doğrulanmış Better Auth kimliği, pilot kodu | Yerel entegrasyon testinde mevcut `users.id` korundu, kanıtsız e-posta eşleme reddedildi; eşzamanlı claim testi eklenmeli. |
| Oturum köprüsü | Hashli ShopAI cookie; Better Auth credential ve MFA | Yerel testte doğrulanmış e-posta + parola + TOTP/tek kullanımlık yedek kod olmadan uygulama oturumu çıkmadı; başarılı girişte hashli oturum ve logout-all kodu var. HTTPS tarayıcı ve gerçek kayıp-cihaz kurtarma kabulü açık. |
| E-posta teslimi | Kullanıcının onayladığı Resend ve secret yönetimi | `auth.fizyoflow.com` Resend'de Verified; staging anahtarıyla test gönderimi HTTP 200 ve gerçek posta kutusuna teslim edildi. Gerçek kayıt doğrulama e-postası da ulaştı; tüm auth akışı kabulü ayrıca açık. |
| Arayüz ve cutover | Giriş, kayıt, doğrulama, TOTP/backup, claim | PR #59 exact SHA staging'de, pilot giriş açık. İlk gerçek doğrulama bağlantısı eksik `callbackURL` nedeniyle API `/` yoluna yönlenip 404 gösterdi; düzeltme staging'e alındı. MFA kurulumunda ham gizli adres yerine tarayıcı içinde üretilen QR ve yalnız istenirse açılan elle kurulum anahtarı eklendi. Bu arayüz değişikliği henüz staging'de değil; gerçek MFA, hesap bağlama ve geri dönüş kabulü açık. |

Güvenlik sınırı: Better Auth'ın `session.token` verisi kendi şemasında açık metin tutulur; ShopAI'nin hashli oturum modeliyle aynı şey değildir. Bu token doğrudan mağaza yetkisi sağlamaz. Uygulama oturumu yalnız sunucuda yeni parola+TOTP challenge doğrulanınca çıkarılır ve geçici Better Auth oturumu iptal edilir. `twoFactorEnabled` kullanıcı bayrağı tek başına MFA kanıtı sayılmaz. Gerçek staging ortamında cookie, e-posta, hesap kurtarma ve log redaksiyonu ayrıca denetlenmelidir.

Kaynaklar: [Better Auth PostgreSQL adapter](https://better-auth.com/docs/adapters/postgresql), [e-posta akışları](https://better-auth.com/docs/concepts/email), [2FA](https://better-auth.com/docs/plugins/2fa).

## 23 Eylül 2026 kabul denemesi — gerçek staging kısmi, uçtan uca kabul açık

| Kontrol | Gözlem | Karar |
|---|---|---|
| Yalıtılmış PostgreSQL, staging ayarları | `tests/integration/better-auth-api.test.ts` ve `better-auth-mfa.test.ts`: 3/3 PASS. HTTPS origin yapılandırmasıyla `__Host-shopai_session; Secure; HttpOnly; SameSite=Lax; Path=/`, eksik/yanlış CSRF reddi, pilot UUID bağlama, TOTP ve reset sonrası session iptali doğrulandı. Resend çağrısı testte stub'dır; gerçek TLS tarayıcısı değildir. | **Teknik simülasyon PASS; dış kabul değil.** |
| Staging veri/yayın | Operatör `a3dea765ee176b516ab042c0e81269b2c095e051` image'ını sunucuya SHA-256 doğrulayarak yükledi; staging DB yedeği `885bc5e4…` Mac'e kopyalanıp izole restore/migration provası yapıldı, sonra staging migration başarılı. Public HTTPS readiness exact SHA, `/v1/auth/capabilities` `betterAuthEnabled:true,pilotEnabled:true`; web `/login` ve Better Auth `get-session` 200. | **Teknik dağıtım PASS; müşteri kabulü değil.** Production'a dokunulmadı. |
| E-posta, HTTPS tarayıcı, gerçek MFA cihazı | Resend alt alan adı Verified; doğrudan API gönderimi 200 ve gerçek gelen kutusuna teslim. Gerçek kayıt doğrulama e-postası ulaştı, fakat link sonrası API `/` için 404 görüldü: Better Auth 1.7.5, `callbackURL` yoksa `/` kullanıyor. Kayıt ve doğrulanmamış giriş payload'ına web dönüşü eklenip URL/redirect regresyonu yazıldı. | **Kısmi/açık.** Düzeltme staging'de henüz yeniden denenmedi; parola+TOTP, yedek kod, reset ve cookie/CSRF tarayıcı kabulü yapılmadı. |
| Gerçek pilot veri ve kullanıcı kabulü | Gerçek staging DB'si yedeklendi ve izole kopyada migration provası yapıldı; pilot hesap sahipliği ve gerçek merchant kullanıcı kabulü ayrıca kanıtlanmadı. | **Bekliyor.** Teknik demo veya test e-postası gerçek müşteri kabulü değildir. |

## 23 Eylül ek dağıtım gözlemi

Operatör `6f6d04177d7255d65bea4d365012f1fe8ca547ff` image'ını sunucuda SHA-256 (`2a2a5f11…`) ile doğrulayıp yükledi. API/web/worker/widget aynı image'a geçirildi; API `healthy`, public HTTPS `/health/ready` exact SHA ve `/v1/auth/capabilities` `betterAuthEnabled:true,pilotEnabled:true` döndü. Widget sağlık kontrolü ve gerçek tarayıcıda doğrulama bağlantısının düzelmiş dönüşü henüz kayda alınmadı. Kullanıcı TOTP kurulumuna ulaşmış olsa da MFA ve uygulama oturumu başarı kanıtı yok. Bu nedenle yukarıdaki gerçek kabul satırlarının **kısmi/açık** durumu değişmez.

QR arayüzü gizli `otpauth://` adresini üçüncü taraf QR hizmetine göndermez; `qrcode.react` istemcide SVG üretir. Kurulum kodu ile yedek kodun farklı amaçları arayüzde açıklanır ve MFA giriş formu yalnız kurulum onayından veya mevcut 2FA challenge'ından sonra açılır. Bu değişiklik için `pnpm check` PASS; staging HTTPS tarayıcı kabulü ve imaj dağıtımı ayrıca gerekir.

## 23 Eylül gerçek tarayıcı gözlemi — yeni hesap, eski pilot bağlama değil

Operatör `ab19e36926338cab109ceaccd68dc97784e57a6d` imajını SHA-256 ile sunucuda doğrulayıp yükledi ve yalnız web servisine geçirdi; `/login` HTTP 200, API/worker/widget `6f6d041…` kaldı. Gerçek tarayıcıda kullanıcı `/dashboard` ekranına ulaştı, doğrulanmış yeni hesapla `ShopAI Staging Test` mağazasını oluşturdu ve boş katalog/bağlantı panelini gördü. Bu, yeni hesap + oturum + ilk mağaza kurulumuna dair staging kanıtıdır; QR'ın bizzat tarandığına dair ayrı gözlem ve e-posta doğrulama linkinin düzelmiş dönüşü kayda alınmadı.

Önceki pilot adresinin sahte geliştirme e-postası olduğu operatörce belirtildi. Bu hesaba gerçek doğrulama postası alınamayacağından canlı pilot→gerçek hesap bağlama denenmedi. Mevcut sentetik pilot kaydı ve mağaza verisi silinmedi; izole entegrasyon testindeki UUID/üyelik koruma kanıtı gerçek müşteri verisi aktarımı diye sunulmaz. Parola kurtarma, çıkış/tüm oturum iptali, hesap kapatma ve gerçek tarayıcıda tenant negatif testleri hâlâ açık. Dashboard'da gerçek çıkış düğmeleri sonraki PR #59 commit'inde eklendi; staging'e alınmadan canlı kabul sayılmaz.

Sonraki kapı: `callbackURL` düzeltmesini staging'de exact SHA ile yeniden dağıt; gerçek tarayıcıda kayıt → e-posta doğrulama dönüşü → TOTP → oturum/CSRF → kurtarma → çıkış senaryolarını kanıtla. Mevcut linkin 404 vermesi doğrulamanın başarısız olduğunu tek başına göstermez; doğrulanmış e-posta durumu giriş akışı veya yetkili DB sorgusuyla ayrıca kontrol edilir. Pilot giriş bu sırada açık tutulur, secret değerleri kanıta yazılmaz ve production DB'ye otomatik migration uygulanmaz.

## 23 Eylül canlı oturum ve kurtarma bulgusu

`e98e48069d2910fb6a36d5a8928b207b212250b4` web imajı staging'de çalıştırıldı. Gerçek tarayıcıda doğrulanmış hesapla aynı `ShopAI Staging Test` mağazası yeniden görüldü. Hem `Tüm oturumlardan çık` hem sonraki girişte `Çıkış yap` düğmesi `/login` sayfasına yönlendirdi; `/dashboard` tekrar açılınca `reason=session_expired` ve erişim iptali mesajı görüldü. Bu, mevcut tarayıcı oturumunun iptaline dair canlı kanıttır; ikinci cihaz oturumunun da iptal edildiğini tek başına kanıtlamaz. Bu testlerin ardından kullanıcı yeniden giriş yapmak zorundadır.

Gerçek sıfırlama e-postası teslim edildi, fakat bağlantı `{"code":"NOT_FOUND"}` döndürdü. Neden: Better Auth'ın `GET /v1/auth/better/reset-password/:token` yönlendirme yolu API izin listesinde yoktu; entegrasyon testi yalnız `POST /reset-password` çağırarak bu boşluğu kaçırdı. Dinamik GET yolu dar bir token biçimiyle izin listesine eklendi; test gerçek e-posta URL'sinin GET yönlendirmesini, web `/login?token=...` dönüşünü ve aynı yola POST reddini kontrol eder. Yerel `pnpm check` ve izole PostgreSQL/Redis entegrasyon testi geçti. Düzeltmenin canlı dağıtımı ve gerçek e-posta bağlantısıyla yeni parola belirleme **henüz kabul edilmedi**. Önceki sıfırlama bağlantısını tekrar kullanmak yerine yeni dağıtımdan sonra yeni bağlantı istenmelidir; anahtarlar/loglar kanıta yazılmaz.

## 23 Eylül şifre kurtarma staging kabulü

Operatör `aa97377ade8efd9b0cf7790c39c32d30bc042204` imajını SHA-256 doğrulayıp staging API'ye dağıttı. Public HTTPS `/health/ready` bu SHA ile `ok` döndü. Uydurma/geçersiz token kullanan salt okunur GET isteği `NOT_FOUND` yerine `/login?error=INVALID_TOKEN` yönlendirmesi verdi; bu kontrol gerçek sıfırlama tokenını kullanmadı. Operatör yeni e-postadaki bağlantıyla parolasını yenilediğini ve yeniden giriş yaptığını bildirdi; aynı tarayıcıda `/dashboard`, `ShopAI Staging Test` mağazası ve önceki `pilot-a47eb889` storefront bağlantısı gözlendi. Bu, staging üzerinde kurtarma → tekrar giriş → mağaza sürekliliği için **olumlu kabul** kanıtıdır; parola, token ve TOTP değeri kaydedilmedi.

Hâlâ açık: şifre yenilemenin başka cihazdaki önceden aktif uygulama oturumunu iptal ettiğine dair canlı çoklu-cihaz kanıtı; gerçek pilot hesabının sahiplik kanıtıyla bağlanması (mevcut pilot e-postası sentetik); A/B mağaza yalıtımı ve shopper yetkisizliği için canlı negatif kabul; hesap kapatma akışının kullanıcı kabulü. Bunların izole entegrasyon testleri canlı müşteri kabulü sayılmaz. Staging'in `.env.staging` içindeki kalıcı `RELEASE_VERSION` değeri ayrıca yeni imaja eşitlenmeli; aksi halde ileride override olmadan Compose çalıştırılması eski sürüme dönebilir. Production DB'ye migration uygulanmadı.

## Güvenlik kapanış kapısı — ayrı teknik ve canlı kanıt

`tests/integration/better-auth-api.test.ts` izole PostgreSQL/Redis üzerinde ek negatif senaryoları geçti: MFA düzeyinde merchant oturumu yalnız üye olduğu A mağazasını listeler/okur; üye olmadığı B mağazasını okuma ve bağlantı oluşturma isteği 403 alır. **Aynı kullanıcıya** ait shopper oturumu, A üyeliği DB'de bulunsa bile mağaza listesini ve A yönetim yolunu 403 ile görür. İki ayrı merchant tarayıcı oturumu ile shopper oturumu aynı kullanıcıya bağlandı; ilk merchant oturumundan `logout-all` sonrası üçünün de `/v1/auth/session` isteği 401 döndü. Bu, API+DB güvenlik kapısının **teknik kabulüdür**; gerçek iki cihaz/iki bağımsız merchant kullanıcı kabulü değildir.

Canlı kalan dar test: kullanıcı iki bağımsız tarayıcı oturumu açarsa birinden `Tüm oturumlardan çık` sonrası diğerinin dashboard/API erişimi reddedilmeli. B mağazası için gerçek yetkili ikinci kullanıcı/mağaza hazır olmadan canlı A/B negatif testini tamamlanmış sayma. Sentetik pilot adresini gerçek hesapla zorla eşleme; gerçek pilot sahibi olduğunda ayrı sahiplik kanıtı iste. Hesap kapatma son owner/retention kararı da ayrı açık kabul maddesidir.
