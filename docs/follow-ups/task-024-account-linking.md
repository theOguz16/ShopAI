# TASK-024 — Web/ChatGPT account linking ve MCP principal sürekliliği

> Kimlik çakışması notu: Görsel kabul artık TASK-025'tir. Bu görev yalnız account-linking ve principal sürekliliğini kapsar.
> Yeni ürün planında bu teknik takip işi **ÜRÜN-016 — Web ve ChatGPT kullanıcı kimliğini birleştir** kapsamının doğrudan dayanağıdır; ÜRÜN-016'nın tam ürün kabulü, ÜRÜN-003 gerçek hesap altyapısına bağlıdır. **ÜRÜN-024**, WooCommerce sipariş attribution işidir; TASK-024 ile aynı görev değildir. Kanonik ilişki: [görev eşleme tablosu](../06-implementation-status.md).

Öncelik: P0 (TASK-011B pilot kapısı)

## Problem

ShopAI web yüzeyi server-issued anonymous cookie kullanırken ChatGPT developer-mode MCP bağlantısı yetkilendirmesizdir. Gerçek host kabulünde `save_product` başarı döndürmüş, fakat aynı konuşmadaki iki `list_saved_products` çağrısı boş kalmıştır. Web, MCP tool çağrısı ve widget arasında tek doğrulanmış kullanıcı principal'ı yoktur.

Koşu sonrasında aynı MCP initialize session'ında server-issued anonymous principal korunacak şekilde transport düzeltildi ve DB entegrasyon testi eklendi. Bu, tek bağlantı içindeki read-after-write sorununu giderir; ChatGPT bağlantısını web hesabıyla eşleştirmez ve yeniden bağlantı/cihazlar arası kalıcılık garantisi vermez.

## Yapılacaklar

- OAuth/account-linking sözleşmesiyle ChatGPT bağlantısını ShopAI kullanıcı/profil kimliğine bağla.
- Anonymous web profilinin açık kullanıcı onayıyla bağlı hesaba güvenli birleşim kuralını tanımla; tenant ve kullanıcı kapsamını DB sorgularında koru.
- MCP tool, widget ve web isteklerinde aynı server-verified principal'ı kullan; istemci tarafından gönderilen kullanıcı kimliğine güvenme.
- Save/unsave ve alert create/cancel/list işlemlerinde read-after-write sürekliliğini ve idempotency'yi doğrula.
- Logout, bağlantı iptali, hesap ayrıştırma ve veri silme/retention davranışını tanımla.
- Ham ChatGPT hesap verisini gereksiz saklama; audit kaydını veri minimizasyonuyla sınırla.

## Kabul

- Aynı bağlı kullanıcı için web save → ChatGPT list ve ChatGPT save → web list aynı kaydı gösterir.
- Alert create/list/cancel iki yüzeyde aynı principal altında tutarlıdır.
- Farklı kullanıcı/merchant verisine erişim ve client-supplied identity spoof'u reddedilir.
- Bağlantı iptalinden sonra yeni MCP çağrısı yetkisiz kalır; mevcut verinin retention/silme davranışı belgelenir.
- Gerçek ChatGPT host koşusunda tarih, release SHA, ekran kaydı ve DB/API mutabakatı kaydedilir.
