# Kimlik ve oturum kararı

İlk pilotta harici kimlik sağlayıcısı yerine DB destekli opaque session kullanılır.
Her davet kodu `AUTH_PILOT_CREDENTIALS` secret'ında tek bir normalize e-postaya
bağlıdır; ortak mağaza kodu yoktur. API e-posta ve kodu birlikte, sabit zamanlı
karşılaştırmayla doğrulamadan kullanıcı/oturum oluşturmaz. Yanlış e-posta ile başka
bir kullanıcıya ait geçerli kod aynı genel `INVALID_CREDENTIALS` yanıtını verir.
Sunucu rastgele oturum değerinin yalnız SHA-256 özetini `sessions` tablosunda tutar.
Oturum varsayılan olarak 24 saat sonra sona erer, çıkışta veritabanından silinir
ve cookie aynı özniteliklerle temizlenir. Cookie her ortamda `HttpOnly`,
`SameSite=Lax` ve `Path=/` taşır; `DEPLOY_ENV=staging|production` olduğunda hem
login hem logout cookie'sine `Secure` eklenir. Local ve test ortamında HTTP ile
çalışabilmek için `Secure` bilinçli olarak eklenmez. Staging/production yalnız
HTTPS origin ayarlarıyla başlatılır.

Login gövdesi strict runtime şemasıyla doğrulanır: e-posta string, geçerli e-posta
ve en fazla 254 karakter; pilot kodu string ve 16–256 karakter olmalıdır. Sayı,
nesne, bilinmeyen alan veya aşırı uzun değer `INVALID_INPUT`/400 döndürür. Şemaya
uyan fakat yanlış e-posta/kod çiftleri hesap varlığını ayırt etmeyen aynı
`INVALID_CREDENTIALS`/401 yanıtını izler. Genel API limiti 60/dakika iken login
ayrıca IP başına varsayılan 5/dakika ile sınırlandırılır; değer
`LOGIN_RATE_LIMIT_MAX` ile 1–30 aralığında ayarlanabilir.

Panel session kontrolünden 401 aldığında kullanıcıyı güvenli bir relative
`returnTo` ile login sayfasına gönderir ve “oturum süresi doldu veya erişiminiz
iptal edildi” mesajını gösterir.

Bu pilot kimlik yöntemi parola sıfırlama veya MFA sağlamaz. Daha geniş yayından
önce doğrulanmış e-posta/MFA destekleyen harici OIDC sağlayıcısına geçiş gerekir.

Pilot kurulumunda ilk giriş yapan kullanıcının `/v1/setup/merchant` endpoint'iyle
tek bir mağaza oluşturmasına izin verilir. Endpoint ikinci kez veya mevcut üyeliği
olan kullanıcı için çalışmaz. Rol kontrolü her yönetim endpoint'inde backend'de
yapılır: `owner` üyelik ve bağlantı yönetir; `editor` katalog/bağlantı yönetir;
`viewer` yalnız okur. Gönderilen merchant ID ve rol hiçbir zaman yetki kaynağı
değildir; üyelik veritabanından yüklenir.

## Pilot erişimini kapatma

Yetkili operatör önce kullanıcının normalize e-postasını ve pilot kodunu teyit
eder. Ardından `AUTH_PILOT_CREDENTIALS` içinden o e-posta/kod eşlemesini kaldırır
ve secret sürümünü yeniden dağıtır; bu yeni login'i kapatır. Mevcut tüm oturumlar
aynı bakım işlemi içinde e-postaya bağlı kullanıcı üzerinden silinir:

```sql
begin;
delete from sessions
where user_id = (select id from users where email = 'pilot@example.com');
commit;
```

Gerçek adres komut geçmişine veya belgeye yazılmaz; operasyon sırasında güvenli
DB istemcisinde parametre olarak verilir. Sonrasında eski cookie ile
`GET /v1/auth/session` ve en az bir mağaza yönetim endpoint'inin 401 döndürdüğü
doğrulanır. Yalnız üyeliği kaldırmak oturumu sonlandırmaz; yalnız session silmek
ise kullanıcıya yeni kodla tekrar giriş imkânı bırakır, bu yüzden iki adım birlikte
uygulanır. Olay zamanı, operatör ve anonim pilot kodu audit kaydına yazılır.

Gerçek staging tarayıcısındaki HTTPS giriş → yenileme → çıkış kabulü T04 yayın
doğrulamasında tamamlanır; yerel HTTP testi bunun yerine geçmez.
