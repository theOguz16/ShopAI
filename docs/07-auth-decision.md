# Kimlik ve oturum kararı — ÜRÜN-003

Karar (23 Eylül 2026): Tek yeni hesap sistemi self-hosted Better Auth 1.7.5'tir. Önceki harici OIDC sağlayıcısı hedefi iptal edilmiştir; Better Auth harici bir OIDC sağlayıcısı gibi sunulmaz. Çalıştırılabilir eski sağlayıcı kodu, UI, bağımlılık ve dağıtım değişkenleri kaldırılmıştır. Uygulanmış `0031`/`0032` migration geçmişi geriye dönük şema uyumluluğu için korunur; bunlar aktif giriş yöntemi değildir. Production'da Better Auth bayrağı varsayılan kapalı, eski pilot giriş bayrağı varsayılan açıktır.

## Geçerli hesap modeli

- E-posta/parola, doğrulanmış e-posta, parola sıfırlama, TOTP ve yedek kod Better Auth tarafından yönetilir. Credential, verification ve 2FA verisi ayrı `shopai_auth` şemasındadır. Yeni merchant uygulama oturumu ancak gerçek parola ve TOTP/yedek kod doğrulamasından sonra oluşturulur; `twoFactorEnabled` bayrağı tek başına MFA kanıtı değildir.
- ShopAI `users.id` UUID, mağaza üyelikleri ve tenant RLS ayrı kalır. Better Auth kimliği `user_identities` ile bağlanır. E-posta benzerliği tek başına pilot kullanıcıyı bağlamaz; doğrulanmış adres, geçerli pilot kodu ve atomik link gerekir. Başarılı link eski pilot oturumlarını iptal eder; mevcut UUID ve ilişkili kayıtlar korunur.
- Yönetim yetkisi yalnız backend'in merchant üyelik sorgusundan gelir. `owner`, `editor`, `viewer` anlamları korunur. Shopper oturumu mağaza yönetimi yapamaz. Oturum çerezi hashli ShopAI oturumuna dayanır; HTTPS ortamında `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/` kullanılır. Değiştirici isteklerde origin ve oturuma bağlı CSRF kontrolü vardır.
- İlk pilot giriş yöntemi kontrollü geçiş için ayrı olarak açık kalır; doğrulanmış e-posta, parola kurtarma veya MFA sağlamaz. Gerçek pilot kullanıcı varlığı doğrulanmadan sentetik pilot adresi gerçek migration kabulü diye sunulmaz.

## Hesap kapatma ve veri politikası

Kullanıcının kararı **soft-close / pasif hesap**tır; kalıcı silme veya anonimleştirme bu işin davranışı değildir. Son `owner` üyeliği olan kişi önce sahipliği devretmeli veya mağazayı kapatma sürecini tamamlamalıdır; mevcut endpoint aksi halde `OWNER_TRANSFER_REQUIRED` döndürür. Uygun hesap kapatıldığında `account_status='closed'` ve `closed_at` yazılır, bütün ShopAI oturumları iptal edilir, Better Auth oturumları sonlandırılır ve mevcut credential ile yeni uygulama girişi reddedilir. UUID, e-posta, credential/TOTP ve ilişkili kişisel/ticari kayıtlar saklanır; bu durum bir kişisel veri silme talebinin karşılandığı anlamına gelmez. Saklama süresi, anonimleştirme ve veri sahibi talep süreci ayrı hukuk/ürün kararı gerektirir. Kapatılan hesabın yeniden etkinleştirilmesi ancak ayrı ve denetlenebilir operasyonla tasarlanabilir; şu an kullanıcı arayüzünde otomatik reaktivasyon yoktur.

## Kabul sınırı

HTTPS staging'de yeni hesap, doğrulama e-postası, MFA, parola kurtarma ve tarayıcılar arası logout-all daha önce gözlendi. `1459a5c25347a4476abbf35c3982d9ebe131420e` API sürümü readiness ve Better Auth capability ile doğrulandı. Legacy pilot envanterinde yalnız operatörün sahte geliştirme adresi olarak tanımladığı `pilot@fizyoflow.com` bulundu; taşınacak gerçek kullanıcı olmadığı için dış migration N/A, temsilî PostgreSQL koruma testi PASS'tır. İki bağımsız merchant/kullanıcı negatif testi ve kapatma uçtan uca testi staging'de tamamlanmadan ÜRÜN-003 kapanmış sayılmaz. Yerel PostgreSQL testleri bu dış kabulün yerine geçmez. Gerçek müşteri pilotu ÜRÜN-032 kapsamındadır. Ayrıntılı kanıt ve açık kapılar [Better Auth geçiş kaydında](follow-ups/urun-003-better-auth-migration.md).
