# ÜRÜN-003 — Better Auth geçiş kaydı

Durum: **Kısmi / açık**. Ürün kararı Better Auth. Auth0 giriş kodu, bağımlılığı, arayüzü ve Compose değişkenleri kaldırıldı. `0031`/`0032` migration geçmişi geriye dönük uyumluluk için korunur; bu eski tasarımın hâlâ çalıştığı anlamına gelmez. Better Auth feature flag varsayılan kapalıdır; pilot giriş varsayılan açıktır. Auth0 ile giriş yapan ortamlar Better Auth secret ve servis kurulmadan yeni giriş kabul edemez. Mevcut uygulama oturumlarının çerez adı uyumluluk için korunmuştur; oturum süresi bitince yeniden giriş gerekir. Bu kayıt teknik testleri gerçek müşteri kabulünden ayırır.

| İş | Bağımlılık | Tamamlanma kanıtı |
|---|---|---|
| Ayrı auth şeması ve paket | Better Auth 1.7.5, PostgreSQL | `0033_better_auth.sql` journal'a eklendi; yalnız kalıcı volume içermeyen izole yerel test DB'sinde uygulandı. Üretim/staging DB'ye uygulanmadı. |
| Hesap bağlama | Doğrulanmış Better Auth kimliği, pilot kodu | Yerel entegrasyon testinde mevcut `users.id` korundu, kanıtsız e-posta eşleme reddedildi; eşzamanlı claim testi eklenmeli. |
| Oturum köprüsü | Hashli ShopAI cookie; Better Auth credential ve MFA | Yerel testte doğrulanmış e-posta + parola + TOTP/tek kullanımlık yedek kod olmadan uygulama oturumu çıkmadı; başarılı girişte hashli oturum ve logout-all kodu var. HTTPS tarayıcı ve gerçek kayıp-cihaz kurtarma kabulü açık. |
| E-posta teslimi | Kullanıcının onayladığı Resend ve secret yönetimi | API URL allowlist ve hata testleri geçti; gerçek posta kutusuna teslim, gönderici domain ve staging secret kabulü bekliyor. |
| Arayüz ve cutover | Giriş, kayıt, doğrulama, TOTP/backup, claim | Auth0 kodunun kaldırılması ürün sahibi tarafından onaylandı. HTTPS staging tarayıcı kabulü, anonimleştirilmiş veri mutabakatı ve geri dönüş planı açık; pilot giriş bunlar tamamlanmadan kaldırılmaz. |

Güvenlik sınırı: Better Auth'ın `session.token` verisi kendi şemasında açık metin tutulur; ShopAI'nin hashli oturum modeliyle aynı şey değildir. Bu token doğrudan mağaza yetkisi sağlamaz. Uygulama oturumu yalnız sunucuda yeni parola+TOTP challenge doğrulanınca çıkarılır ve geçici Better Auth oturumu iptal edilir. `twoFactorEnabled` kullanıcı bayrağı tek başına MFA kanıtı sayılmaz. Gerçek staging ortamında cookie, e-posta, hesap kurtarma ve log redaksiyonu ayrıca denetlenmelidir.

Kaynaklar: [Better Auth PostgreSQL adapter](https://better-auth.com/docs/adapters/postgresql), [e-posta akışları](https://better-auth.com/docs/concepts/email), [2FA](https://better-auth.com/docs/plugins/2fa).
