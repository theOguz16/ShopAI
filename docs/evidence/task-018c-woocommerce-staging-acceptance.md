# TASK-018C — WooCommerce staging kabul takibi

Tarih: 22 Eylül 2026

PR: [#55](https://github.com/theOguz16/ShopAI/pull/55)

PR head: `bd21ee466de3e383e6930dc9e81e1aeb012b0a69`

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
| Aktif ShopAI bağlantısında 520 ürün / 300 native variation / 720 normalize variant | **BLOCKED** | **Doğrulanmadı** | Staging DB/VDS yetkisi bu oturumda yok. Aşağıdaki şema-doğrulanmış sorgu operatör tarafından çalıştırılmalı; LocalWP satırları filtre dışında. |
| Test Urunu 1 WooCommerce kaynak S/M/L, fiyat, stok, görsel | **PASS** | Woo source IDs 13/14/15/16 | S/M/L; 451/461/471 TRY; her biri 5 stok; aynı blue PNG. |
| Test Urunu 1 ShopAI DB/API mutabakatı | **BLOCKED** | **Doğrulanmadı** | Staging DB ve pilot API oturumu yok. |
| Test Urunu 1 dashboard detayı | **BLOCKED** | **Doğrulanmadı** | Dashboard geçerli pilot oturumu olmadan login'e yönlendiriyor. |
| Test Urunu 78 kök neden | **PASS** | Woo source product ID 321 | Kaynak Store API `images: []`; placeholder kaynak eksikliğinin sonucu. |
| Test Urunu 78 tek ürün görsel düzeltmesi ve incremental aktarım | **BLOCKED** | Aktif connection ID **doğrulanmadı** | Kaynak/VDS yazma yetkisi yok; hiçbir staging verisi değiştirilmedi. Kontrollü plan aşağıda. |
| PR son commit yerel/CI doğrulaması | **BLOCKED** | `bd21ee466de3e383e6930dc9e81e1aeb012b0a69` | Push-event CI `check` ve `integration` PASS; GitGuardian PASS. Aynı SHA'nın PR-event duplicate `check` job'u PASS, duplicate `integration` job'u TASK-023A adımında halen IN_PROGRESS. Main branch protection tanımlı değil; GitHub açısından required context yok. |
| PR commit hosted staging deploy + smoke | **FAIL** | Hosted SHA `a8594cfcb739932a2fcaec94fad27b545d3724c1` | Hosted readiness hâlâ eski SHA'yı döndürüyor. PR SHA deploy edilmedi; eski smoke yeni davranışların kanıtı değildir. Repoda branch preview/izole staging deploy workflow'u yok. |
| TASK-018 gerçek merchant şartı | **BLOCKED** | uygulanmaz | Bu sentetik pilottur; bağımsız ve izinli gerçek WooCommerce merchant kabulü yoktur. |

## Kök neden ve düzeltmeler

- Fixture üreticisi parent custom attribute anahtarını ve variation meta anahtarını bağımsız sabit metinlerle kuruyordu. WooCommerce parent attribute'ları `sanitize_title(attribute name)` ile indekslediğinden iki taraf ayrıştığında wc/v3 variation `option` alanı boş dönebiliyor. Üretici artık variation anahtarlarını doğrudan oluşturulan parent `WC_Product_Attribute` nesnesinden türetiyor ve her save sonrasında `wc_get_product_variation_attributes()` ile kalıcı alanı doğruluyor.
- GD yokken fixture daha önce görselsiz üretime devam edebiliyordu. Kabul fixture'ı artık bu durumda fail-fast davranıyor; görsel eksikliğini sessizce üretmiyor.
- Sync panelindeki sayaçlar yalnız son çalışmanın sayaçlarıdır. Değişiklik bulmayan incremental çalışma meşru olarak `0 / 0 / 0` gösterebilir. API/UI artık çalışma modunu ve o bağlantıya ait mevcut katalog ürün/varyant toplamlarını ayrı gösterir.
- İptal edilmiş bağlantı `active=false` veya `authorization_status=revoked` olduğu için health hesabında `attention` üretiyordu ve aktiflerle aynı listede çiziliyordu. API `active` alanını döndürüyor; UI aktif bağlantıları `Bağlantı geçmişi`nden ayırıyor ve genel son başarılı sync yalnız aktif bağlantılardan hesaplanıyor. Geçmiş silinmiyor.

## Otomatik kanıt

- `pnpm check`: PASS — 31 test dosyası, 130 test PASS; typecheck ve production build PASS. WooCommerce rehearsal credential gerektiren 3 test beklendiği gibi skip.
- Hedef unit: 4 dosya, 20 test PASS.
- İzole `shopai_woo_acceptance` PostgreSQL DB + yerel Redis üzerinde `sync-status` ve `catalog-health`: 2 dosya, 4 integration test PASS.
- Public staging smoke yalnız eski release `a8594cfcb739932a2fcaec94fad27b545d3724c1` için PASS. Bu sonuç PR #55'in davranışları için kabul kanıtı değildir.

## Açık staging kabul kapıları

`https://shop.fizyoflow.com/dashboard` geçerli pilot oturumu olmadan login ekranına yönlendirdi. Bu nedenle aşağıdakiler bu koşuda **PASS değildir**:

- 520 ürünün tamamının aktif WooCommerce connection ID'sine ait olduğunun DB mutabakatı.
- Beklenen varyant sayısının aktif connection bazında mutabakatı.
- Test Urunu 1'in ShopAI private katalog API/DB ve dashboard detayındaki S/M/L, fiyat, stok, görsel eşitliği.
- Görseli kaynaktan eklendikten sonra Test Urunu 78'in bir incremental sync ile ShopAI'ye taşındığının doğrulanması.

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

Aktif worker bağlantıları beş dakikada bir incremental kuyruğa alır; manuel DB/job ekleme yapılmamalı. Değişiklikten önce aktif connection ID ve `last_successful_sync_at` kaydedilmeli, kaynak `date_modified_gmt` ilerledikten sonra yeni bir `last_successful_sync_at` beklenmeli. Sonrasında versioned read-only SQL yeniden çalıştırılmalı ve Test Urunu 78 için `image_url` dolu olmalıdır. Bu koşu yapılmadığı için sonuç **BLOCKED** durumundadır.

## Merge kararı

PR henüz merge'e hazır kabul edilmemelidir. Kod/test tarafında başarılı bir son-SHA CI koşusu vardır; ancak duplicate PR integration koşusu bitmemiştir, PR SHA hosted/izole staging'e deploy edilmemiştir ve aktif connection bazlı DB/API kabul sonuçları alınmamıştır. TASK-018 gerçek merchant şartı ayrıca açık kalır.
