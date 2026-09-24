# ÜRÜN-006 — Canonical category mapping kararı

## Amaç ve mevcut durum

ÜRÜN-006 öncesinde kaynak kategori adı import sırasında `normalizeCategory` ile
`products.category` alanına yazılıyor; ÜRÜN-005 yalnız
`source_category_id` ve `source_category_path` alanlarını ayrıca koruyordu.
Public search doğrudan `products.category` üzerinden filtreliyor, pilot
`categories/category_facets` seed'i ise `size/color` ağırlıklı statik
seçenekler taşıyordu. Merchant bazlı source → canonical mapping ve unmapped
catalog-health sinyali yoktu.

ÜRÜN-006 legacy `products.category` alanını geriye uyumluluk için tutar, ancak
onu canonical kategori olarak kabul etmez. Yeni akış source provenance ile
ShopAI taxonomy bilgisini ayrı alanlarda taşır.

## Source category preservation

Yeni importlar şu provenance bilgisini kayıpsız korur:

- `products.source_category_name`: provider'dan gelen ham kategori adı,
- `products.source_category_id`: provider'ın stable category ID'si,
- `products.source_category_path`: provider hiyerarşisinin tam path dizisi,
- `products.source_category_provider`: import connection provider'ı,
- `products.merchant_id` ve `products.connection_id`: tenant/source scope.

Legacy `products.category` normalize edilmiş uyumluluk alanıdır. Canonical
mapping hiçbir zaman source alanlarını overwrite etmez.

Provider stable source category ID göndermiyorsa ürün kaybolmaz ve aramada
source verisiyle kalabilir; ancak güvenilir mapping anahtarı kurulamadığı için
canonical kategoriye otomatik atanmaz. Catalog health bunu unmapped product
olarak gösterir.

## Canonical ShopAI category tree

Canonical tree global ve provider bağımsızdır. Stable key olarak
`categories.slug` kullanılır; her node `name`, `parent_slug` ve `active`
taşır.

İlk kabul ağacı bilinçli olarak dardır:

- `apparel` — Giyim
  - `tshirt` — Tişört
- `fishing` — Balıkçılık
  - `fishing-rod` — Olta
- `sports` — Spor

Yeni kategori eklemek import/search koduna provider veya product-specific
`if` eklemeyi gerektirmez; tree ve facet metadata'sı veri olarak genişler.

## Mapping modeli ve lifecycle

`source_category_mappings` ayrı tablodur. Unique mapping scope:

`merchant_id + connection_id + provider + source_category_id`

Bu nedenle aynı source ID iki merchant veya iki connection arasında ortak
mapping kabul edilmez. Mapping durumları:

- `needs_mapping`: canonical target yoktur,
- `mapped`: aktif bir canonical category key seçilmiştir.

Import, stable source ID gördüğünde yeni kaydı yalnız `needs_mapping` olarak
açar veya var olan mapping'in source name/path gözlemini günceller. Var olan
canonical target'ı import sırasında değiştirmez. İsim benzerliği otomatik
birleştirme sinyali değildir; `Tişört` ve `T-shirt` aynı canonical node'a
ancak explicit mapping ile gidebilir.

Merchant mapping update endpoint'i aynı target tekrar yazıldığında timestamp'i
değiştirmeden mevcut sonucu döndürür; bu davranış idempotenttir. Target
`null` yapılırsa kayıt tekrar `needs_mapping` olur.

## Facet/category ilişkisi ve units

`category_facets` artık yalnız statik option listesi değil, generic attribute
modeline bağlanan metadata taşır:

- `attribute_scope`: `product` veya `variant`,
- `attribute_key`: ÜRÜN-005 `CatalogAttribute.key`,
- `unit`: facet için beklenen unit metadata'sı,
- `active` ve `position`.

İlk kabul:

- Tişört: `size`, `color`, `material`,
- Olta: `length`, mevcut legacy `action/casting_weight` ve generic
  `power`,
- Spor: `capacity`, `size`, `number`, `weight`.

Search facet değerleri ürün/varyantların generic
`descriptive_attributes/options` JSON'undan hesaplanır. Olta mapping'i beden
facet'i tanımlamadığı için legacy `variants.size` dolu olsa bile beden facet'i
gösterilmez.

`length` metadata'sı `cm`, `capacity` metadata'sı `ml` taşır. Source
attribute içindeki `unit` ve `rawValue` ÜRÜN-005 modeli üzerinde korunur.
ÜRÜN-006 unit conversion yapmaz; farklı unit'leri sessizce dönüştürmez.

## Search ve catalog health davranışı

Public canonical category filter mapping join'i üzerinden çalışır. Join
provider/connection/source ID provenance'ına bağlıdır ve yalnız
`status = mapped` target'ları kabul eder. Parent node seçimi doğrudan child
mapping'lerini de kapsar.

Canonical mapped-only filtre yalnız istekte açıkça gönderilen `category`
alanına uygulanır. Parser'ın serbest metinden çıkardığı kategori ipucu ve
ürün detayındaki benzer ürün sorgusu legacy `products.category` normalize
değeri üzerinden filtreler; aksi halde kategori içeren her serbest metin
araması, merchant eşleme yapana kadar unmapped ürünleri tamamen gizlerdi.
İki yol aynı `filters.category` alanını paylaşmaz: explicit istek canonical
join'e, ipucu/sistem kaynaklı değer legacy predicate'e gider.

Unmapped ürün:

- source category bilgisini kaybetmez,
- category filter verilmemiş genel katalog sonucunda görünmeye devam edebilir,
- canonical category facet/count'a girmez,
- canonical category filter ile eşleşmez.

Search item'ı legacy `category` alanına ek olarak ayrı
`sourceCategory` ve nullable `canonicalCategory` alanları döndürür.

Catalog health iki sinyal döndürür:

- `unmappedCategories`: `needs_mapping` mapping kayıt sayısı,
- `unmappedProducts`: stable ID/provider eksikliği veya mapped target yokluğu
  nedeniyle canonical kategori çözülemeyen ürün sayısı.

## Merchant UI, authorization ve tenant isolation

`/dashboard/categories` ekranı source path, provider, connection ve source ID
ile mevcut canonical target'ı gösterir; all/mapped/unmapped filtresi sunar.

- owner/editor: mapping seçebilir, değiştirebilir veya kaldırabilir,
- viewer: yalnız okuyabilir.

API read route'u `owner/editor/viewer`, update route'u
`owner/editor` ile korunur. Her DB işlemi `setTenantContext` ile RLS tenant
scope'unda çalışır. Başka merchant'ın mapping kaydı API/UI üzerinden
listelenemez veya update edilemez. Public DB role mapping tablosunda yalnız
canonical search için gereken kolonları ve yalnız public merchant'ın
`mapped` satırlarını okuyabilir; source name/path kolonları public role'a
grant edilmez.

## Migration ve merge sırası

Branch migration'ı `0035_category_mapping.sql` olarak oluşturuldu ve Drizzle
`meta/_journal.json` içine eklendi. Migration additive schema değişiklikleri,
legacy provenance backfill'i, canonical seed ve RLS/grant kurallarını içerir;
production DB'ye bu task kapsamında uygulanmaz.

ÜRÜN-004 secret lifecycle branch'i de migration üretiyor. Bu nedenle
`0035` numarası merge edilene kadar geçicidir. ÜRÜN-006 main'e alınmadan hemen
önce güncel `main` migration sırası yeniden kontrol edilir; bir çakışma varsa
yalnız ÜRÜN-006 migration/journal entry'si güvenli biçimde renumber edilir.
Secret/env/OpenBao dosyaları ÜRÜN-006 tarafından değiştirilmez.

## Kapsam dışı

Bu karar dünya çapında tam taxonomy, AI ile serbest kategori tahmini,
ÜRÜN-013 ortak discovery ekranının tamamı, ÜRÜN-014 merchant-scoped discovery
UX'i, ÜRÜN-017 personalization veya provider-specific Woo/Shopify full
acceptance içermez.
