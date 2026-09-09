# Kimlik ve oturum kararı

İlk pilotta harici kimlik sağlayıcısı yerine DB destekli opaque session kullanılır.
Her davet kodu `AUTH_PILOT_CREDENTIALS` secret'ında tek bir normalize e-postaya
bağlıdır; ortak mağaza kodu yoktur. API e-posta ve kodu birlikte, sabit zamanlı
karşılaştırmayla doğrulamadan kullanıcı/oturum oluşturmaz. Yanlış e-posta ile başka
bir kullanıcıya ait geçerli kod aynı genel `INVALID_CREDENTIALS` yanıtını verir.
Sunucu rastgele oturum değerinin yalnız SHA-256 özetini `sessions` tablosunda tutar.
Oturum 24 saat sonra sona erer, çıkışta veritabanından silinir ve
HttpOnly/SameSite=Lax cookie temizlenir.

Bu pilot kimlik yöntemi parola sıfırlama veya MFA sağlamaz. Daha geniş yayından
önce doğrulanmış e-posta/MFA destekleyen harici OIDC sağlayıcısına geçiş gerekir.

Pilot kurulumunda ilk giriş yapan kullanıcının `/v1/setup/merchant` endpoint'iyle
tek bir mağaza oluşturmasına izin verilir. Endpoint ikinci kez veya mevcut üyeliği
olan kullanıcı için çalışmaz. Rol kontrolü her yönetim endpoint'inde backend'de
yapılır: `owner` üyelik ve bağlantı yönetir; `editor` katalog/bağlantı yönetir;
`viewer` yalnız okur. Gönderilen merchant ID ve rol hiçbir zaman yetki kaynağı
değildir; üyelik veritabanından yüklenir.
