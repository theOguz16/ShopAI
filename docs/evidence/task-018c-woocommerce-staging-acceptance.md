# TASK-018C — WooCommerce staging kabul takibi

Tarih: 22 Eylül 2026

PR: [#55](https://github.com/theOguz16/ShopAI/pull/55)

Merged/deployed commit: `3cf084a04e3934b72bc088c4c8babd205aa3946a`

Bu kayıt sentetik WooCommerce staging pilotunun salt okunur kanıtını, kod düzeltmelerini ve henüz doğrulanamayan kapıları ayırır. Sentetik mağaza gerçek merchant kabulü değildir.

## Doğrulanan kaynak verisi

WooCommerce public Store API üzerinden, veri değiştirmeden:

- `[SENTETIK DEMO] ShopAI Test Urunu 1` parent ID `13`; varyantlar:
  - ID `14`, `Beden: S`, `451.00 TRY`, `5 adet stokta`.
  - ID `15`, `Beden: M`, `461.00 TRY`, `5 adet stokta`.
  - ID `16`, `Beden: L`, `471.00 TRY`, `5 adet stokta`.
- Üç varyant da `https://woo-pilot.fizyoflow.com/wp-content/uploads/2026/09/shopai-synthetic-blue.png` görselini döndürüyor.
- `[SENTETIK DEMO] ShopAI Test Urunu 78` parent ID `321`; S/M/L varyantları var fakat kaynak Store API `images: []` döndürüyor. ShopAI katalog placeholder'ı bu nedenle URL veya render hatası değil, kaynak görsel eksikliğinin doğru gösterimidir.
- Store API'nin altı sayfası birlikte sayıldı: `X-WP-Total=520`, 520 benzersiz sentetik ürün, 420 simple ürün, 100 variable ürün ve 300 benzersiz native WooCommerce variation.

ShopAI modeli her simple ürünü de tek normalize variant satırı olarak saklar. Bu nedenle başarılı tam mutabakatta iki ayrı sayı beklenir:

- Native WooCommerce variation: **300** (`v.external_id <> p.external_key`).
- ShopAI normalize variant: **720** (`420 simple row + 300 native variation`).

## Kabul matrisi

| Madde | Durum | Connection ID / deploy SHA | Kanıt veya engel |
| --- | --- | --- | --- |
| WooCommerce kaynak toplamı | **PASS** | Woo source; connection ID uygulanmaz | Public Store API: 520 ürün, 300 native variation, 420 simple + 100 variable. |
| Aktif ShopAI bağlantısında 520 ürün / 300 native variation / 720 normalize variant | **PASS** | `9b00753e-de43-4720-8dd2-175ef8fc2838`; deploy `3cf084a` | VDS read-only SQL tek aktif bağlantıda 520 ürün, 300 native variation, 720 normalize variant ve 720 aktif teklif döndürdü. |
| Test Urunu 1 WooCommerce kaynak S/M/L, fiyat, stok, görsel | **PASS** | Woo source IDs 13/14/15/16 | S/M/L; 451/461/471 TRY; her biri 5 stok; aynı blue PNG. |
| Test Urunu 1 ShopAI DB/API mutabakatı | **PASS** | `9b00753e-de43-4720-8dd2-175ef8fc2838`; deploy `3cf084a` | DB ve authenticated API: S/M/L, 45100/46100/47100 minor TRY, stok kullanılabilir ve aynı blue PNG. Login/session/product API HTTP 200. |
| Test Urunu 1 dashboard detayı | **PASS** | deploy `3cf084a` | Oturumlu Brave kontrolünde kart görseli, 3 varyant ve detayda L ₺471, M ₺461, S ₺451; üçü de `Stokta`. |
| Test Urunu 78 kök neden | **PASS** | Woo source product ID 321 | Kaynak Store API `images: []`; placeholder kaynak eksikliğinin sonucu. |
| Test Urunu 78 tek ürün görsel düzeltmesi ve incremental aktarım | **PASS** | product `321`; `9b00753e-de43-4720-8dd2-175ef8fc2838` | Eski thumbnail yokluğu root-only rollback JSON'una kaydedildi; yalnız attachment `11` atandı. Woo Store API ve dashboard görseli PASS; `12:30:22` incremental sync sonrası ShopAI DB/API aynı URL'yi döndürdü. |
| PR son commit yerel/CI doğrulaması | **PASS** | PR head `20d549e44c32ed4e255ba1996385cebd81006dcf` | Zorunlu check/integration ve GitGuardian PASS; takılan duplicate integration iptal edilip aynı SHA üzerinde başarılı yeniden koşuldu. |
| PR commit hosted staging deploy + smoke | **PASS** | merge/deploy `3cf084a04e3934b72bc088c4c8babd205aa3946a` | Exact-release readiness ve `scripts/staging-chatgpt-smoke.mjs` PASS; api/worker/web/widget aynı immutable image'ı çalıştırdı. |
| TASK-018 teknik pilot kabulü | **PASS** | PR #55; deploy `3cf084a` | Sentetik WooCommerce staging kabulü kaynak → ShopAI DB/API → oturumlu dashboard boyunca tamamlandı. |
| Gerçek merchant/user pilotu | **BLOCKED (TASK-023B)** | uygulanmaz | Gerçek ve izinli mağaza yoktur; sentetik kanıt gerçek merchant sonucu olarak sunulmaz ve TASK-023B açık kalır. |

## Kök neden ve düzeltmeler

- Fixture üreticisi parent custom attribute anahtarını ve variation meta anahtarını bağımsız sabit metinlerle kuruyordu. WooCommerce parent attribute'ları `sanitize_title(attribute name)` ile indekslediğinden iki taraf ayrıştığında wc/v3 variation `option` alanı boş dönebiliyor. Üretici artık variation anahtarlarını doğrudan oluşturulan parent `WC_Product_Attribute` nesnesinden türetiyor ve her save sonrasında `wc_get_product_variation_attributes()` ile kalıcı alanı doğruluyor.
- GD yokken fixture daha önce görselsiz üretime devam edebiliyordu. Kabul fixture'ı artık bu durumda fail-fast davranıyor; görsel eksikliğini sessizce üretmiyor.
- Sync panelindeki sayaçlar yalnız son çalışmanın sayaçlarıdır. Değişiklik bulmayan incremental çalışma meşru olarak `0 / 0 / 0` gösterebilir. API/UI artık çalışma modunu ve o bağlantıya ait mevcut katalog ürün/varyant toplamlarını ayrı gösterir.
- İptal edilmiş bağlantı `active=false` veya `authorization_status=revoked` olduğu için health hesabında `attention` üretiyordu ve aktiflerle aynı listede çiziliyordu. API `active` alanını döndürüyor; UI aktif bağlantıları `Bağlantı geçmişi`nden ayırıyor ve genel son başarılı sync yalnız aktif bağlantılardan hesaplanıyor. Geçmiş silinmiyor.

## Otomatik kanıt

- `pnpm check`: PASS — 31 test dosyası, 130 test PASS; typecheck ve production build PASS. WooCommerce rehearsal credential gerektiren 3 test beklendiği gibi skip.
- Hedef unit: 4 dosya, 20 test PASS.
- İzole `shopai_woo_acceptance` PostgreSQL DB + yerel Redis üzerinde `sync-status` ve `catalog-health`: 2 dosya, 4 integration test PASS.
- PR head `20d549e44c32ed4e255ba1996385cebd81006dcf` zorunlu CI koşuları PASS; merge/deploy SHA `3cf084a04e3934b72bc088c4c8babd205aa3946a` exact-release readiness ve hosted smoke PASS.

## Tamamlanan staging kabul kanıtı

- Aktif connection `9b00753e-de43-4720-8dd2-175ef8fc2838`; merchant `b376073a-e8d3-4dbf-af05-2ebc431dfcb9`.
- Read-only DB sonucu: 520 ürün, 300 native Woo variation, 720 normalize variant, 720 aktif teklif. Revoked LocalWP connection `37166412-bf34-450e-ba7b-0b3dd8e26f7b` yalnız tarihsel sorguda yer aldı.
- Dashboard son incremental çalışmayı `0 / 0 / 0 / 0` olarak, aynı bağlantının mevcut kataloğunu ayrı satırda `520 ürün · 720 varyant` olarak gösterdi.
- Catalog Health aktif WooCommerce bağlantısını `Healthy`, iptal edilmiş LocalWP'yi `Bağlantı geçmişi` altında `İptal edildi` olarak gösterdi.
- Test Urunu 1 kaynak, DB, authenticated API ve dashboard detayında S/M/L, fiyat, stok durumu ve görsel açısından eşleşti.
- Test Urunu 78 kaynak eksikliği yalnız product `321` üzerinde geri alınabilir biçimde düzeltildi. Rollback kaydı `/home/deploy/shopai-staging-runtime-backups/test-urunu-78/thumbnail-before-20260922T122750Z.json`; kaynak watermark `2026-09-22 12:27:52+00`, başarılı incremental sync `2026-09-22 12:30:23.369+00`.

### VDS'de secret yazdırmadan çalıştırma

Repo ve `.env.staging` dosyasının bulunduğu dizinde aşağıdaki komut secret değerini ekrana basmaz. `set +x` shell tracing'i kapatır; SQL yalnız okur:

```bash
set +x
set -a
. ./.env.staging
set +a
test -n "${STAGING_DATABASE_URL:-}" || { echo 'STAGING_DATABASE_URL missing' >&2; exit 1; }
psql "$STAGING_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f docs/evidence/task-018c-staging-readonly.sql
unset STAGING_DATABASE_URL
```

DB host yalnız Docker networkünden erişilebiliyorsa aynı SQL dosyasını PostgreSQL containerında çalıştırın; URL'yi `echo`, `env`, `set` veya `docker inspect` ile yazdırmayın.

Yetkili operatörün çalıştıracağı sorgular ayrıca versioned `docs/evidence/task-018c-staging-readonly.sql` dosyasındadır. Temel sorgu aktif, yetkili WooCommerce bağlantısını açıkça filtreler:

```sql
select id, provider, active, authorization_status, sync_mode,
       last_sync_started_at, last_successful_sync_at, last_fetched_at,
       last_sync_error, revoked_at
from source_connections
where provider = 'woocommerce'
order by active desc, last_successful_sync_at desc nulls last;

select c.id as connection_id, c.merchant_id,
       count(distinct p.id) as products,
       count(distinct v.id) filter (where v.external_id <> p.external_key) as native_woo_variations,
       count(distinct v.id) as normalized_variants,
       count(distinct o.id) filter (where o.active) as active_offers
from source_connections c
left join products p
  on p.merchant_id = c.merchant_id and p.connection_id = c.id
left join variants v
  on v.merchant_id = c.merchant_id and v.connection_id = c.id
left join offers o
  on o.merchant_id = c.merchant_id and o.connection_id = c.id
where c.provider = 'woocommerce'
  and c.active = true
  and c.authorization_status = 'active'
group by c.id, c.merchant_id
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
  and exists (
    select 1 from source_connections c
    where c.id = p.connection_id
      and c.merchant_id = p.merchant_id
      and c.provider = 'woocommerce'
      and c.active = true
      and c.authorization_status = 'active'
  )
order by p.title, v.size;
```

Beklenen kabul: tek aktif connection ID'de `520` ürün, `300` native Woo variation ve `720` normalize ShopAI variant; Test Urunu 1 için üç kaynak satırı birebir; iptal edilmiş LocalWP yalnız history sorgusunda.

## Kontrollü veri düzeltme planı

Test Urunu 78 için toplu seed veya yayın işlemi yapılmamalı. Kaynakta yalnız product ID `321` için mevcut sentetik görsel ID `11` atanmalı; önce eski `_thumbnail_id` güvenli bir root-only dosyaya kaydedilmelidir:

```bash
umask 077
before=/root/shopai-test-78-thumbnail.before
old_value="$(wp post meta get 321 _thumbnail_id 2>/dev/null || true)"
printf '%s' "${old_value:-__EMPTY__}" > "$before"
wp post meta update 321 _thumbnail_id 11
wp wc product get 321 --user=1 --field=images
```

Geri dönüş:

```bash
before=/root/shopai-test-78-thumbnail.before
old_value="$(cat "$before")"
if [ "$old_value" = '__EMPTY__' ]; then
  wp post meta delete 321 _thumbnail_id
else
  wp post meta update 321 _thumbnail_id "$old_value"
fi
```

Bu plan product `321` için uygulandı. Eski değerde `_thumbnail_id` yoktu; rollback JSON'u root-only dizinde korundu. Attachment `11` atandıktan sonra kaynak `date_modified_gmt` ilerledi, worker'ın normal incremental scheduler çalışması beklendi ve yeni `last_successful_sync_at` sonrasında ShopAI DB/API ile oturumlu dashboard aynı görseli gösterdi. Manuel DB/job eklenmedi, toplu seed/yayın yapılmadı ve bağlantı iptal edilmedi.

## Kapanış kararı

PR #55 merge edildi ve `3cf084a04e3934b72bc088c4c8babd205aa3946a` staging'e deploy edildi. Sentetik TASK-018 teknik pilot kabulü **tamamlandı**. Gerçek merchant/user pilotu bu kapanışla karşılanmış sayılmaz; ayrı TASK-023B kabul kapısı olarak açık kalır.
