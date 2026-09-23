# ÜRÜN-003 — Better Auth geçiş kaydı

Durum: **Mühendislik testleri PASS; staging kabulü açık**. Ürün kararı Better Auth. Önceki sağlayıcının çalıştırılabilir giriş kodu, bağımlılığı, arayüzü ve Compose değişkenleri kaldırıldı. `0031`/`0032` uygulanmış migration geçmişi şema uyumluluğu için korunur; kullanılmayan kimlik işlem tablosunun DB'den kaldırılması veri/backup incelemesi gerektirir. Better Auth feature flag varsayılan kapalıdır; pilot giriş varsayılan açıktır. Mevcut uygulama oturumlarının çerez adı uyumluluk için korunmuştur; oturum süresi bitince yeniden giriş gerekir. Bu kayıt teknik testleri gerçek müşteri kabulünden ayırır. Aşağıdaki tarihli paragraflar olay kronolojisidir; **geçerli karar tablosu bu paragrafın altındadır**.

| 23 Eylül güncel kapı | Durum | Kanıt / eksik |
|---|---|---|
| HTTPS kayıt, e-posta, MFA, kurtarma, çıkış | PASS (teknik staging) | Doğrulanmış test hesabı ve iki tarayıcıda oturum iptali; gerçek müşteri pilotu değil. |
| İki bağımsız merchant/kullanıcı ve shopper 403 | YEREL PASS, STAGING BEKLİYOR | İzole DB HTTP entegrasyonunda çift yönlü 403; staging'de iki doğrulanmış kimlik kurulmalı. |
| Son owner ve soft-close | YEREL PASS, STAGING BEKLİYOR | `OWNER_TRANSFER_REQUIRED`, tüm ShopAI ve Better Auth oturumlarının bitmesi, yeniden giriş reddi, credential kaydının korunması test edildi. Son owner'a transfer/mağaza kapatma tamamlanmadan izin yok. |
| Legacy pilot migration | YEREL PASS, DIŞ MIGRATION N/A | 23 Eylül staging `users` sayımı `active=1,pilot=1` döndü; tek pilot adresi `pilot@fizyoflow.com`. Operatör bu adresin sahte geliştirme hesabı olduğunu önceden doğruladı. Taşınacak gerçek legacy kullanıcı yoktur. Temsilî PostgreSQL testinde UUID, merchant üyeliği ve ilgili keşif kaydı korunur; bu canlı müşteri taşıması değildir. |
| Retention/anonymization | SOFT-CLOSE KARARI KAYITLI | Kalıcı silme/anonimleştirme yok; kişisel veri saklama süresi ve hak talebi ayrıca kararlaştırılmalı. |

Hesap kapatma kararı (23 Eylül): Bu aşamada **soft-close** uygulanır; `users.account_status='closed'` ve `closed_at` yazılır. Son owner üyeliği olan hesap, sahiplik transferi veya mağaza kapatma tamamlanmadan kapanamaz (`OWNER_TRANSFER_REQUIRED`). Başarılı kapatmada ShopAI oturumları iptal edilir, Better Auth oturumlarının süresi bitirilir; aynı e-posta/şifreyle yeni giriş reddedilir. UUID, merchant/ticari kayıtlar, e-posta, Better Auth credential/TOTP ve kişisel kullanıcı kayıtları **kalıcı silinmez veya anonimleştirilmez**. Kapatılmış hesap kullanıcıya erişim sağlamaz; ileride yeniden etkinleştirme ancak ayrı, yetkili ve denetlenebilir operasyonla tasarlanabilir. Bu teknik soft-close, kişisel veri silme talebinin yerine geçtiği iddiası değildir. Yasal retention/anonimleştirme süresi, yedek döngüsü ve hak talebi süreci ayrıca kararlaştırılmadan üretim veri silme kabulü verilmez.

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

Bu aşamada açık olanlar: farklı tarayıcıdaki önceden aktif oturumun iptaline dair canlı kanıt; gerçek pilot hesabının sahiplik kanıtıyla bağlanması (mevcut pilot e-postası sentetik); A/B mağaza yalıtımı ve shopper yetkisizliği için canlı negatif kabul; hesap kapatma akışının kullanıcı kabulü. İzole entegrasyon testleri canlı müşteri kabulü sayılmaz. Staging'in `.env.staging` içindeki kalıcı `RELEASE_VERSION` değeri ayrıca yeni imaja eşitlenmeli; aksi halde ileride override olmadan Compose çalıştırılması eski sürüme dönebilir. Production DB'ye migration uygulanmadı.

## Güvenlik kapanış kapısı — ayrı teknik ve canlı kanıt

`tests/integration/better-auth-api.test.ts` izole PostgreSQL/Redis üzerinde ek negatif senaryoları geçti: MFA düzeyinde merchant oturumu yalnız üye olduğu A mağazasını listeler/okur; üye olmadığı B mağazasını okuma ve bağlantı oluşturma isteği 403 alır. **Aynı kullanıcıya** ait shopper oturumu, A üyeliği DB'de bulunsa bile mağaza listesini ve A yönetim yolunu 403 ile görür. Şifre sıfırlama, önceden aktif farklı tarayıcı oturumunu da 200'den 401'e düşürür. İki ayrı merchant tarayıcı oturumu ile shopper oturumu aynı kullanıcıya bağlandı; ilk merchant oturumundan `logout-all` sonrası üçünün de `/v1/auth/session` isteği 401 döndü. Bu, API+DB güvenlik kapısının **teknik kabulüdür**; gerçek iki cihaz/iki bağımsız merchant kullanıcı kabulü değildir.

Bu teknik kanıtın ardından iki bağımsız tarayıcıyla canlı oturum iptali denendi (aşağıda). B mağazası için gerçek yetkili ikinci kullanıcı/mağaza hazır olmadan canlı A/B negatif testini tamamlanmış sayma. Sentetik pilot adresini gerçek hesapla zorla eşleme; gerçek pilot sahibi olduğunda ayrı sahiplik kanıtı iste. Hesap kapatma son owner/retention kararı da ayrı açık kabul maddesidir.

## İki bağımsız tarayıcıda canlı toplu çıkış

Operatör, aynı hesapla Codex in-app browser ve Brave gizli penceresinde panelin açık olduğunu doğruladı. In-app browser'da `Tüm oturumlardan çık` tıklandığında `/login` açıldı. Ardından Brave gizli penceresindeki `https://shop.fizyoflow.com/dashboard/analytics` sayfası yenilendi; `https://shop.fizyoflow.com/login?reason=session_expired&returnTo=%2Fdashboard%2Fanalytics` adresine yönlendi. Bu, **ayrı tarayıcı cookie jar'ındaki önceden aktif uygulama oturumunun canlı iptali** için olumlu kanıttır. Farklı fiziksel cihaz, şifre sıfırlamanın ikinci canlı tarayıcı oturumunu iptali veya gerçek müşteri kabulü olarak yorumlanmaz. Test sonunda iki oturumda da yeniden giriş gerekir; token, parola ve MFA kodu kaydedilmedi.

## 23 Eylül envanter ve `1459a5c` staging API gözlemi

Operatör `1459a5c25347a4476abbf35c3982d9ebe131420e` branch'ini VDS'de klonladı, aynı SHA için linux/amd64 imajını oluşturdu ve API servisine dağıttı. HTTPS `/health/ready` tam SHA ve `status:ok`, `/v1/auth/capabilities` ise `betterAuthEnabled:true,pilotEnabled:true` döndü. Bu yalnız API dağıtım kanıtıdır; web/worker/widget ve kalıcı `.env.staging` sürümünü otomatik olarak güncellemez. Dağıtım öncesi PostgreSQL yedeği `/home/deploy/shopai-private-backups/shopai-staging-pre-1459-onO5UPe0.dump` (`414568` bayt, mod `600`) alındı ve `pg_restore --list` ile okunabildiği doğrulandı.

Gerçek DB'de `account_status` sayımı `active|1`, `pilot|1`; tek pilot adresi `pilot@fizyoflow.com`. Operatör önceki incelemede bu adresin sahte geliştirme hesabı olduğunu belirtti. Bu nedenle **taşınacak gerçek legacy pilot kullanıcı yoktur; dış migration N/A**. Sentetik pilot kaydı silinmedi veya yeni kimliğe zorla bağlanmadı. İzole PostgreSQL testi eski UUID'yi, merchant üyeliğini ve ilişkili keşif kaydını koruyarak teknik migration yolunu sınar; gerçek müşterinin taşındığı iddiası değildir.

Canlı iki bağımsız merchant, shopper ve soft-close kapıları hâlâ açıktır. Kullanıcı kimlik bilgileri, doğrulama bağlantıları ve TOTP değerleri kanıta kaydedilmez.
