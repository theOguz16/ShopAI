# ÜRÜN-005 — genel ürün ve satın alınabilir varyant modeli

## Başlangıç durumu (main `7217123f9ff2438560465bcfd3e41dbce3818e48`)

- `SourceRow` ve `CatalogItem` beden/renk alanlarını zorunlu tutuyordu. `products` ürünün kaynak anahtarını, metnini, kategorisini ve tek görselini; `variants` kaynak varyant kimliği ile beden/renk bilgisini saklıyordu.
- Fiyat ve para birimi `offers`, stok `inventory` seviyesindeydi. `inventory.available = null` bilinmeyen stoktur; `false` stok yoktur. Redirect hedefi `offers.checkout_url` üzerinde tutuluyordu.
- Ürün kimliği `(connection_id, external_key)`, varyant ve teklif kimliği `(connection_id, external_id)` ile tekildi; merchant ilişkileri birleşik foreign key ve RLS ile korunuyordu. Kaynak kimlikleri zaten `text` idi ve Shopify GID gibi string değerler için numeric dönüşüm gerekmiyordu.
- Woo normalizasyonu yalnız beden/renk seçimini çıkarıyordu; farklı adlardaki seçenekler, birimler ve açıklayıcı özellikler kayboluyordu. Varyant görseli ürün görseli alanına yazılabiliyor, böylece son işlenen varyant ürün görselini değiştirebiliyordu.
- Arama/facet kodunda beden/renk hâlâ özel alan ve filtrelerdir. Web ve widget ürün detayında renk ve beden seçimi ayrı hard-coded idi. ÜRÜN-006 facet/taksonomi kapsamına dokunulmadı.

## Yeni model

- `products.descriptive_attributes`: satın alma seçimi olmayan kaynak özellikleri. Her kayıt `key`, `value`, opsiyonel `label`, `unit`, `sourceKey`, `rawValue` taşır. Woo çok değerli kaynak özelliklerinde özgün dizi ayrıca `rawValues` içinde saklanır. Kaynakta olmayan değer eklenmez.
- `variants.options`: aynı biçimde satın alınabilir seçenekler. Seçenek adı serbesttir; sıra canonical key sırasına çekilir. Seçenek dizisi kimlik değildir: mevcut kaynak varyant ID'si `(connection_id, external_id)` authoritative kimliktir.
- `variants.image_url/image_alt`: seçili varyant görseli; yoksa ürün görseli fallback. Fiyat, stok ve checkout URL seçili varyantın teklifinden okunur. Public detay kaynak varyant ID'sini de taşır.
- `products.source_category_id/source_category_path`: kaynak sınıflandırması için ayrı alan. Woo ilk kategori ID'sini korur; tam kategori ağaç eşlemesi ÜRÜN-006'dadır.
- `size/color` alanları eski veri, mevcut facet araması ve istemciler için tutulur. Yeni genel seçenekler bu alanları doldurmak zorunda değildir. Eski satırlarda açık `variantOptions` yoksa import size/color'dan genel seçenek üretir. Migration eski kayıtlar için aynı dönüşümü yapar; sentinel `ONE_SIZE` ve `unspecified` seçenek sayılmaz.
- `available=null` bilinmeyen stoktur. Bu durumda satın alma seçimi kapalıdır; out-of-stock etiketi basılmaz. TRY tek desteklenen para birimidir. Contract TRY dışını reddeder; Woo para birimini `settings/general` kaynağından doğrulayamazsa senkronizasyonu hata ile durdurur. [Woo settings endpoint kaynak kodu](https://woocommerce.github.io/code-reference/files/woocommerce-includes-rest-api-controllers-version2-class-wc-rest-setting-options-v2-controller.html) okuma yetkisini kontrol eder; mevcut pilot anahtarının buna erişimi gerçek Woo hesabında ayrıca kabul edilmelidir.

## Migration ve uyumluluk

`0034_generic_product_variants.sql` yalnız yeni nullable/varsayılan JSONB alanlar ekler ve eski varyantlara kontrollü beden/renk backfill uygular. Fiyat/stok/kimlik tabloları değişmez. Üretim DB'sine bu görev sırasında migration uygulanmadı. PR #63'ün güncel `main` bazı `7217123f9ff2438560465bcfd3e41dbce3818e48` üzerinde son migration `0033` olduğu için `0034` korunur. Ayrı PR #61'in kendi branch'inde `0034_connector_secret_lifecycle.sql` ve `0035_connector_secret_backend.sql` bulunur. Planlanan sıralama: PR #63 önce merge edilir; PR #61 kendi branch'inde daha sonra güncel main'e rebase edilip iki migration'ı `0035/0036` olarak yeniden numaralandırılır. Bu PR, PR #61 branch'ini veya migration içeriklerini değiştirmez.

Eski public contract alanları hâlâ vardır. Yeni detay görünümü seçenek adlarını genel biçimde gösterir; eski kayıtlarda beden/renk etiketi kullanılır. Arama facetleri şimdilik eski beden/renk projeksiyonunu kullanır. Woo varyant permalink'i kaynağa özgü şekilde mevcut değilse ürün permalink'i checkout target olarak kalır; gerçek varyant seçimi URL'si ayrıca ÜRÜN-009 kabulünde doğrulanmalıdır.

## Kanıt sınırı

`tests/fixtures/generic-catalog.ts` giyim, balıkçılık ve spor kaynak satırlarını içerir. Unit/connector testleri arbitrary `Capacity = 750 ml`, GID string kimlik, TRY dışı ret, görsel ve kaynak seçenek ayrımını doğrular. PostgreSQL testi import retry, option sırası, merchant izolasyonu, seçili varyant fiyat/stok/görsel/redirect ve bilinmeyen stoku doğrular. Genel ürün/varyant modelinin teknik kabulü ÜRÜN-005'te tamamlandı. Gerçek Woo mağazasında **currency-settings endpoint okuma yetkisi** ile **seçili varyantın satın alma URL'sinin doğru kaynak varyanta açılması** ÜRÜN-009 gerçek Woo katalog kabulüne devredildi; ÜRÜN-005 blocker'ı değildir. Shopify connector bu kapsamda uygulanmadı.
