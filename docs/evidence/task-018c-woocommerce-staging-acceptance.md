# TASK-018C — WooCommerce staging kabul takibi

Tarih: 22 Eylül 2026

Bu kayıt sentetik WooCommerce staging pilotunun salt okunur kanıtını, kod düzeltmelerini ve henüz doğrulanamayan kapıları ayırır. Sentetik mağaza gerçek merchant kabulü değildir.

## Doğrulanan kaynak verisi

WooCommerce public Store API üzerinden, veri değiştirmeden:

- `[SENTETIK DEMO] ShopAI Test Urunu 1` parent ID `13`; varyantlar:
  - ID `14`, `Beden: S`, `451.00 TRY`, `5 adet stokta`.
  - ID `15`, `Beden: M`, `461.00 TRY`, `5 adet stokta`.
  - ID `16`, `Beden: L`, `471.00 TRY`, `5 adet stokta`.
- Üç varyant da `https://woo-pilot.fizyoflow.com/wp-content/uploads/2026/09/shopai-synthetic-blue.png` görselini döndürüyor.
- `[SENTETIK DEMO] ShopAI Test Urunu 78` parent ID `321`; S/M/L varyantları var fakat kaynak Store API `images: []` döndürüyor. ShopAI katalog placeholder'ı bu nedenle URL veya render hatası değil, kaynak görsel eksikliğinin doğru gösterimidir.

## Kök neden ve düzeltmeler

- Fixture üreticisi parent custom attribute anahtarını ve variation meta anahtarını bağımsız sabit metinlerle kuruyordu. WooCommerce parent attribute'ları `sanitize_title(attribute name)` ile indekslediğinden iki taraf ayrıştığında wc/v3 variation `option` alanı boş dönebiliyor. Üretici artık variation anahtarlarını doğrudan oluşturulan parent `WC_Product_Attribute` nesnesinden türetiyor ve her save sonrasında `wc_get_product_variation_attributes()` ile kalıcı alanı doğruluyor.
- GD yokken fixture daha önce görselsiz üretime devam edebiliyordu. Kabul fixture'ı artık bu durumda fail-fast davranıyor; görsel eksikliğini sessizce üretmiyor.
- Sync panelindeki sayaçlar yalnız son çalışmanın sayaçlarıdır. Değişiklik bulmayan incremental çalışma meşru olarak `0 / 0 / 0` gösterebilir. API/UI artık çalışma modunu ve o bağlantıya ait mevcut katalog ürün/varyant toplamlarını ayrı gösterir.
- İptal edilmiş bağlantı `active=false` veya `authorization_status=revoked` olduğu için health hesabında `attention` üretiyordu ve aktiflerle aynı listede çiziliyordu. API `active` alanını döndürüyor; UI aktif bağlantıları `Bağlantı geçmişi`nden ayırıyor ve genel son başarılı sync yalnız aktif bağlantılardan hesaplanıyor. Geçmiş silinmiyor.

## Otomatik kanıt

- `pnpm check`: PASS — 31 test dosyası, 130 test PASS; typecheck ve production build PASS. WooCommerce rehearsal credential gerektiren 3 test beklendiği gibi skip.
- Hedef unit: 4 dosya, 20 test PASS.
- İzole `shopai_woo_acceptance` PostgreSQL DB + yerel Redis üzerinde `sync-status` ve `catalog-health`: 2 dosya, 4 integration test PASS.
- Public staging smoke: release `a8594cfcb739932a2fcaec94fad27b545d3724c1`; readiness, MCP, widget v4 asset, yayımlanmış demo detail ve signed checkout PASS.

## Açık staging kabul kapıları

`https://shop.fizyoflow.com/dashboard` geçerli pilot oturumu olmadan login ekranına yönlendirdi. Bu nedenle aşağıdakiler bu koşuda **PASS değildir**:

- 520 ürünün tamamının aktif WooCommerce connection ID'sine ait olduğunun DB mutabakatı.
- Beklenen varyant sayısının aktif connection bazında mutabakatı.
- Test Urunu 1'in ShopAI private katalog API/DB ve dashboard detayındaki S/M/L, fiyat, stok, görsel eşitliği.
- Görseli kaynaktan eklendikten sonra Test Urunu 78'in bir incremental sync ile ShopAI'ye taşındığının doğrulanması.

Yetkili operatör aşağıdaki salt okunur SQL'i staging DB read-only oturumunda çalıştırmalıdır:

```sql
select id, provider, active, authorization_status, sync_mode,
       last_sync_started_at, last_successful_sync_at, last_fetched_at,
       last_sync_error, revoked_at
from source_connections
where provider = 'woocommerce'
order by active desc, last_successful_sync_at desc nulls last;

select c.id as connection_id,
       count(distinct p.id) as products,
       count(distinct v.id) as variants,
       count(distinct o.id) filter (where o.active) as active_offers
from source_connections c
left join products p
  on p.merchant_id = c.merchant_id and p.connection_id = c.id
left join variants v
  on v.merchant_id = c.merchant_id and v.connection_id = c.id
left join offers o
  on o.merchant_id = c.merchant_id and o.connection_id = c.id
where c.provider = 'woocommerce'
group by c.id
order by c.id;

select p.title, p.connection_id, p.image_url, p.image_alt,
       v.external_id, v.size, v.color,
       o.price_minor, o.currency, o.active,
       i.available
from products p
join variants v
  on v.merchant_id = p.merchant_id and v.product_id = p.id
left join offers o
  on o.merchant_id = v.merchant_id and o.variant_id = v.id
left join inventory i
  on i.merchant_id = o.merchant_id and i.offer_id = o.id
where p.title in (
  '[SENTETIK DEMO] ShopAI Test Urunu 1',
  '[SENTETIK DEMO] ShopAI Test Urunu 78'
)
order by p.title, v.size;
```

Beklenen kabul: aktif bağlantıda tam `520` ürün; varyant toplamı kaynak WooCommerce wc/v3 sonucuyla aynı; Test Urunu 1 için yukarıdaki üç kaynak satırı birebir; iptal edilmiş LocalWP satırı yalnız geçmiş grubunda.

## Kontrollü veri düzeltme planı

Test Urunu 78 için toplu seed veya yayın işlemi yapılmamalı. Kaynakta yalnız product ID `321` için mevcut sentetik görsel ID'si atanmalı; önce eski `_thumbnail_id` değeri kaydedilmeli. Geri dönüş, bu tek meta değerini eski değerine almak veya önceden boşsa silmektir. Ardından yalnız mevcut incremental sync çalıştırılıp yukarıdaki iki ürün sorgusu tekrar edilmelidir.
