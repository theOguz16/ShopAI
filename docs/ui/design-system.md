# ShopAI Tasarım Sistemi — v1.0 (ÜRÜN-019)

> Tek doğruluk kaynağı: [`packages/ui/src/tokens.css`](../../packages/ui/src/tokens.css).
> Bu doküman onun insan-okur özetidir; ikisi çakışırsa tokens.css kazanır.
> Canlı referans: web uygulamasında `/design` rotası (`apps/web/app/design`).
> **Görünürlük:** rota yalnız dev ve staging'dedir; production'da
> (`DEPLOY_ENV=production`) middleware 404 döndürür
> (`apps/web/middleware.ts` + `apps/web/lib/design-reference.ts`).
> Doğrulama araçları: `node scripts/design-contrast-report.mjs [--md]` ve
> `node scripts/design-evidence.mjs` (screenshot/taşma kanıtı; CI'da
> `design-evidence` job'ı çıktıyı artifact olarak saklar, PNG'ler repoya
> eklenmez).

**Kapsam:** `apps/web` (storefront + merchant dashboard) ve
`apps/chatgpt-widget`. **Kapsam dışı:** auth akışları, staging
konfigürasyonu, DB/API davranışı (ÜRÜN-003 ile çakışmaması için hiçbir auth
dosyasına dokunulmadı).

## 1. Tasarım prensipleri

1. **Semantic isimlendirme.** Token adları UI anlamı taşır
   (`--shopai-color-action-primary`, `--shopai-color-surface-raised`);
   `blue-500` tipi salt renk adı tüketici yüzeyine sızmaz.
2. **Tek paydaş havuz.** Web ve widget aynı token dosyasını kullanır
   (`@shopai/ui/tokens.css`). Her iki uygulamada da tüm sabit hex'ler
   token'a bağlandı.
3. **Yalnız renkle bilgi yok.** Stok/durum/senkron bilgisi daima nokta/rozet
   **ve** okunur etiket taşır (WCAG 1.4.1).
4. **Durumlar birinci sınıf.** Her ekran default/loading/empty/error'ı
   (gerektiğinde warning/success/info/permission ile) `StateCard` ve
   `Skeleton` primitive'leriyle kurar; ad-hoc metin paragrafları yeni
   kodda kullanılmaz.
5. **Veri üretme.** Backend'de olmayan metrik/ürün uydurulmaz; referans
   içerik açıkça `reference`/`Demo` etiketlidir.
6. **Ölçülü Motion.** Tüm animasyonlar `prefers-reduced-motion: reduce`
   altında kapanır (web globals + `shopai-*` primitive'leri + widget).
7. **Küçük primitive, büyük ekran.** Paylaşılan paket yalnız durum
   primitive'leri ve token taşır; form/tablo/grafik framework'ü yazılmaz.

## 2. Tema modeli

- Light tema `:root` varsayılanıdır.
- Dark tema **attribute ile** açılır: `<html data-shopai-theme="dark">`
  (veya herhangi bir kapsayıcı; `.shopai-scope` sınıfı da izole tema
  verir). tokens.css bilinçli olarak `prefers-color-scheme` medya sorgusu
  içermez — tema seçimi uygulamaya aittir.
- Web: `apps/web/app/layout.tsx` hydrate öncesi çalışır bir script ile
  sırayla `localStorage('shopai-theme')` → sistem tercihi → light uygular.
  Böylece mevcut tüm sayfalar (legacy alias değişkenleri üzerinden) dark
  temayı otomatik alır.
- Widget (ChatGPT host): ÜRÜN-019'da host teması yeniden tasarlanmadı;
  widget bugün light paletiyle render eder (`color-scheme: light`).
  **ÜRÜN-020 için hazır:** host köprüsü widget kökünde
  `data-shopai-theme` attribute'unu set ettiğinde dark set geçerli olur;
  CSS tarafında ek iş kalmaz. Host bridge/state mantığına dokunulmadı.

## 3. Token tablosu

Tüm adlar `--shopai-` öneklidir (host sayfa çakışmalarını önler).
Aşağıdaki tablo grup özetidir; tam liste ve değerler tokens.css'tedir.

### 3.1 Yüzey

| Token | Light | Dark | Kullanım |
| --- | --- | --- | --- |
| `--shopai-color-bg-page` | `#f6f5ef` | `#101410` | Sayfa zemini |
| `--shopai-color-surface` | `#ffffff` | `#1a1f1a` | Kart/panel yüzeyi |
| `--shopai-color-surface-muted` | `#eceee8` | `#222822` | Soluk blok, görsel zemini |
| `--shopai-color-surface-raised` | `#ffffff` | `#1e241e` | Dropdown/yüzen kart |
| `--shopai-color-surface-inverse` | `#172019` | `#f2f4ec` | Ters bant (merchant switcher) |

### 3.2 Metin

| Token | Light | Dark | Kullanım |
| --- | --- | --- | --- |
| `--shopai-color-text-primary` | `#151715` | `#f1f4ec` | Başlık/gövde |
| `--shopai-color-text-secondary` | `#3f443e` | `#c9cfc5` | İkincil açıklama |
| `--shopai-color-text-muted` | `#5c625b` | `#a2aaa1` | Yardım/meta |
| `--shopai-color-text-on-inverse` | `#ffffff` | `#151715` | Ters bant üstü |
| `--shopai-color-text-on-action` | `#ffffff` | `#26320a` | Primary buton üstü |

### 3.3 Eylem

| Token | Light | Dark | Kullanım |
| --- | --- | --- | --- |
| `--shopai-color-action-primary` | `#151715` | `#d9ff43` | Primary buton zemini |
| `--shopai-color-action-primary-hover` | `#333c33` | `#e6ff77` | Primary hover |
| `--shopai-color-action-secondary-bg` | `#ffffff` | `#232923` | Secondary zemin |
| `--shopai-color-action-secondary-hover` | `#f3f5f0` | `#2b322b` | Secondary hover |
| `--shopai-color-action-secondary-border` | `#151715` | `#4c544c` | Secondary kenarlık |
| `--shopai-color-action-secondary-text` | `#151715` | `#f1f4ec` | Secondary metin |
| `--shopai-color-action-disabled-bg` | `#e4e7e1` | `#262b26` | Disabled zemin |
| `--shopai-color-action-disabled-text` | `#6d736c` | `#8b938a` | Disabled metin |

### 3.4 Marka vurgusu

| Token | Light | Dark | Kullanım |
| --- | --- | --- | --- |
| `--shopai-color-accent` | `#d9ff43` | `#d9ff43` | Vurgu zemini (facet aktif, adım işareti) |
| `--shopai-color-accent-ink` | `#3d4b00` | `#d9ff43` | Vurgu renkli metin/çizgi |
| `--shopai-color-on-accent` | `#26320a` | `#26320a` | Vurgu üstü metin |
| `--shopai-color-accent-soft` | `22% alfa` | `14% alfa` | Vurgu flu zemini |

### 3.5 Durum renkleri (metin/zemin/kenarlık üçlüsü)

| Durum | text (light/dark) | bg (light/dark) | border (light/dark) |
| --- | --- | --- | --- |
| success | `#1e6b40` / `#8fd8ab` | `#e8f3ea` / `#1b3024` | `#b3d4bd` / `#2f5a41` |
| warning | `#634f00` / `#ffd97a` | `#fff1b8` / `#2f2a16` | `#d9bb4e` / `#5f5224` |
| error | `#8e2828` / `#ff9c92` | `#fdf0f0` / `#34201d` | `#e4b5b5` / `#6b342b` |
| info | `#33517a` / `#a5c4f2` | `#e9f0f9` / `#1c2839` | `#bfcedf` / `#3a5273` |
| neutral | `#5c625b` / `#b9c0b7` | `#eceee8` / `#262c26` | `#d0d4cc` / `#3c433c` |

Stok varyantları: `--shopai-color-stock-in-stock`,
`-out-of-stock`, `-unknown`, `-stale` (daima `stockStatusLabel` metniyle).

### 3.6 Kenarlık, odak, katman, hareket

| Token | Light | Dark | Not |
| --- | --- | --- | --- |
| `--shopai-color-border` | `#d9dcd4` | `#343a34` | Normal kenarlık |
| `--shopai-color-border-strong` | `#83887f` | `#6e786e` | 3:1 UI kontrastı sağlar |
| `--shopai-color-focus-ring` | `#5a7500` | `#d9ff43` | 3px `outline-offset:3px` |
| `--shopai-shadow-card` / `-raised` | 2 ton | 2 ton | Dark'ta derinlik kenarlıkla da gelir |
| `--shopai-z-sticky/-overlay/-toast` | 200/300/400 | — | Katman sırası |
| `--shopai-transition-fast/-base` | 120/200ms | — | Sadece renk/geçiş özellikleri |

### 3.7 Ölçekler

- **Spacing (4px taban):** `--shopai-space-1…12` = 4/8/12/16/20/24/32/40/48px.
- **Radius:** `sm 8 · md 10 · lg 14 · xl 18 · 2xl 24 · pill 999`.
- **Tipografi:** `--shopai-font-size-2xs 11 · xs 12 · sm 13 · md 14 · base 16 · lg 18 · 2xl 24 · 3xl 32`; ağırlıklar `medium 600 · bold 700 · extrabold 800`; satır aralığı `tight 1.25 · base 1.5`. Font ailesi tek token: `--shopai-font-family` (Inter + sistem yedeği).

## 4. Erişilebilirlik

Hedefler ve doğrulama: normal metin **≥ 4.5:1**, UI bileşeni/odak **≥ 3:1**
(WCAG 1.4.3 / 1.4.11). `scripts/design-contrast-report.mjs` tokens.css'i
parse eder, 50 renk çiftini hesaplar, hedef altında kalanda **non-zero
exit** verir (CI'a bağlanabilir).

Son doğrulama (v1.0): **50/50 çift geçti.** Ayrıntılı tablo:

<!-- CONTRAST_REPORT_START -->

| Tema | Çift | Değerler | Hedef | Oran | Sonuç |
| --- | --- | --- | --- | --- | --- |
| light | Sayfa metni / sayfa zemini | `#151715 / #f6f5ef` | 4.5:1 | 16.50 | ✓ |
| light | Kart metni / kart yüzeyi | `#151715 / #ffffff` | 4.5:1 | 18.02 | ✓ |
| light | İkincil metin / kart yüzeyi | `#3f443e / #ffffff` | 4.5:1 | 9.96 | ✓ |
| light | Sönük metin / sayfa zemini | `#5c625b / #f6f5ef` | 4.5:1 | 5.73 | ✓ |
| light | Sönük metin / kart yüzeyi | `#5c625b / #ffffff` | 4.5:1 | 6.26 | ✓ |
| light | Buton metni / primary buton | `#ffffff / #151715` | 4.5:1 | 18.02 | ✓ |
| light | Ters bant metni / ters bant | `#ffffff / #172019` | 4.5:1 | 16.71 | ✓ |
| light | Vurgu üstü metin / vurgu zemini | `#26320a / #d9ff43` | 4.5:1 | 11.88 | ✓ |
| light | Vurgu metni / sayfa zemini | `#3d4b00 / #f6f5ef` | 4.5:1 | 8.72 | ✓ |
| light | Vurgu metni / kart yüzeyi | `#3d4b00 / #ffffff` | 4.5:1 | 9.52 | ✓ |
| light | Secondary buton metni | `#151715 / #ffffff` | 4.5:1 | 18.02 | ✓ |
| light | Success durumu | `#1e6b40 / #e8f3ea` | 4.5:1 | 5.70 | ✓ |
| light | Warning durumu | `#634f00 / #fff1b8` | 4.5:1 | 6.99 | ✓ |
| light | Error durumu | `#8e2828 / #fdf0f0` | 4.5:1 | 7.61 | ✓ |
| light | Info durumu | `#33517a / #e9f0f9` | 4.5:1 | 7.04 | ✓ |
| light | Neutral durum | `#5c625b / #eceee8` | 4.5:1 | 5.36 | ✓ |
| light | Stok: mevcut etiketi | `#1e6b40 / #ffffff` | 4.5:1 | 6.50 | ✓ |
| light | Stok: tükendi etiketi | `#8e2828 / #ffffff` | 4.5:1 | 8.45 | ✓ |
| light | Stok: bilinmiyor etiketi | `#634f00 / #ffffff` | 4.5:1 | 7.93 | ✓ |
| light | Stok: bayat etiketi | `#634f00 / #ffffff` | 4.5:1 | 7.93 | ✓ |
| light | Odak halkası (UI, 3:1) | `#5a7500 / #f6f5ef` | 3:1 | 4.83 | ✓ |
| light | Odak halkası / kart yüzeyi (UI, 3:1) | `#5a7500 / #ffffff` | 3:1 | 5.28 | ✓ |
| light | Belirgin kenarlık (UI, 3:1) | `#83887f / #ffffff` | 3:1 | 3.62 | ✓ |
| light | Primary buton zemini (UI, 3:1) | `#151715 / #f6f5ef` | 3:1 | 16.50 | ✓ |
| light | Devre dışı (rapor) | `#6d736c / #e4e7e1` | - | 3.89 | ✓ |
| dark | Sayfa metni / sayfa zemini | `#f1f4ec / #101410` | 4.5:1 | 16.72 | ✓ |
| dark | Kart metni / kart yüzeyi | `#f1f4ec / #1a1f1a` | 4.5:1 | 15.06 | ✓ |
| dark | İkincil metin / kart yüzeyi | `#c9cfc5 / #1a1f1a` | 4.5:1 | 10.53 | ✓ |
| dark | Sönük metin / sayfa zemini | `#a2aaa1 / #101410` | 4.5:1 | 7.79 | ✓ |
| dark | Sönük metin / kart yüzeyi | `#a2aaa1 / #1a1f1a` | 4.5:1 | 7.01 | ✓ |
| dark | Buton metni / primary buton | `#26320a / #d9ff43` | 4.5:1 | 11.88 | ✓ |
| dark | Ters bant metni / ters bant | `#151715 / #f2f4ec` | 4.5:1 | 16.24 | ✓ |
| dark | Vurgu üstü metin / vurgu zemini | `#26320a / #d9ff43` | 4.5:1 | 11.88 | ✓ |
| dark | Vurgu metni / sayfa zemini | `#d9ff43 / #101410` | 4.5:1 | 16.23 | ✓ |
| dark | Vurgu metni / kart yüzeyi | `#d9ff43 / #1a1f1a` | 4.5:1 | 14.61 | ✓ |
| dark | Secondary buton metni | `#f1f4ec / #232923` | 4.5:1 | 13.37 | ✓ |
| dark | Success durumu | `#8fd8ab / #1b3024` | 4.5:1 | 8.41 | ✓ |
| dark | Warning durumu | `#ffd97a / #2f2a16` | 4.5:1 | 10.56 | ✓ |
| dark | Error durumu | `#ff9c92 / #34201d` | 4.5:1 | 7.61 | ✓ |
| dark | Info durumu | `#a5c4f2 / #1c2839` | 4.5:1 | 8.34 | ✓ |
| dark | Neutral durum | `#b9c0b7 / #262c26` | 4.5:1 | 7.67 | ✓ |
| dark | Stok: mevcut etiketi | `#8fd8ab / #1a1f1a` | 4.5:1 | 10.02 | ✓ |
| dark | Stok: tükendi etiketi | `#ff9c92 / #1a1f1a` | 4.5:1 | 8.31 | ✓ |
| dark | Stok: bilinmiyor etiketi | `#e8d27f / #1a1f1a` | 4.5:1 | 11.12 | ✓ |
| dark | Stok: bayat etiketi | `#e8d27f / #1a1f1a` | 4.5:1 | 11.12 | ✓ |
| dark | Odak halkası (UI, 3:1) | `#d9ff43 / #101410` | 3:1 | 16.23 | ✓ |
| dark | Odak halkası / kart yüzeyi (UI, 3:1) | `#d9ff43 / #1a1f1a` | 3:1 | 14.61 | ✓ |
| dark | Belirgin kenarlık (UI, 3:1) | `#6e786e / #1a1f1a` | 3:1 | 3.65 | ✓ |
| dark | Primary buton zemini (UI, 3:1) | `#d9ff43 / #101410` | 3:1 | 16.23 | ✓ |
| dark | Devre dışı (rapor) | `#8b938a / #262b26` | - | 4.56 | ✓ |

<!-- CONTRAST_REPORT_END -->

Ek kurallar:

- **Görünür klavye focus'u:** web ve widget'ta tüm `button/a/input/select`
  öğelerinde 3px halka (`--shopai-color-focus-ring`, offset 3px). Hiçbir
  bileşen focus'u gizlemez.
- **hover/focus/disabled:** buton aileleri token'lı hover zemini kullanır;
  disabled öğelerde `cursor: not-allowed` (widget) / `wait` (yüklenen
  storefront aksiyonları) + disabled token ikilisi. Disabled kontrastı
  WCAG kapsamı dışındadır ama raporlanır (light 3.89, dark 4.56).
- **Form hataları:** hata inputu kalın error-border alır ve metin hatası
  renk + cümle olarak görünür (`ds-field-error` referansı).
- **Yalnız renk yok:** stok = nokta + etiket; katalog health satırı =
  rozet + metin; bayat veri = uyarı rozeti + tarih.

## 5. Ortak bileşen durumları

Primitive'ler `packages/ui/src/states.tsx` + `states.css`
(`@shopai/ui/states.css` olarak import edilir; tokens.css'ten sonra).

| Durum | Primitive | ARIA | Kullanım kuralı |
| --- | --- | --- | --- |
| loading | `StateCard variant="loading"` (canlı metin) | `role="status"` | Sayfa/bölüm ilk yüklemesi; buton içi beklemede disabled + metin soneki `…` |
| skeleton | `Skeleton`, `ProductCardSkeleton` | `aria-hidden` | Layout biliniyorsa loading yerine; daima yanında canlı `role="status"` metni |
| empty | `StateCard variant="empty"` | `role="status"` | Kesinlikle boş liste döndüğünde; sonraki adım önerisi ekle |
| error | `StateCard variant="error"` | `role="alert"` | İstek hatası; mümkünse Yeniden dene eylemi |
| warning | `StateCard variant="warning"` | `role="status"` | Bayat veri, reauthorization, demo-veri notu |
| success | `StateCard variant="success"` | `role="status"` | İşlem onayı (kalıcı durum; toast yok) |
| info | `StateCard variant="info"` | `role="status"` | "Ölçülmüyor" gibi nötr bilgi |
| disabled | buton `disabled` + disabled token | doğal | Kalıcı pasiflik için satır açıklaması ekle |
| missing image | `MissingImage` | `role="img"` + aria-label "X görseli yok" |imageUrl yoksa **ve** `onError`'da; kart asla boş kalmaz |
| stale data | `StockBadge status="stale"` / `StateCard warning` | — | Son kontrol zamanı metinle verilir |
| permission denied | `StateCard variant="permission"` | `role="status"` | Yetki adını ve yapılacak şeyi yaz |

## 6. Responsive kurallar

Doğrulama `scripts/design-evidence.mjs` ile (320/390/1440 × light/dark,
yatay taşma taraması + screenshot). Sonuçlar bu dosyanın 9. bölümünde.

| Genişlik | Kural |
| --- | --- |
| **320px** | Tüm grid'ler tek kolon; `.filter-controls`, `.store-search`, facet ve form satırları dikey; header sarar; butonlar tam genişlik (mobil bloğu); **scrollWidth ≤ 320 garanti** |
| **390px** | Storefront ürün grid'i 2 kolon; widget 2 kolon (≤380px'de 1); dashboard kartları tek kolon; facet chip satırları yatay kaydırılabilir |
| **1440px** | Shell üst sınırı 1120–1180px ortalanır; ürün grid'i 3 kolon; facet satırı 3'lü; analytics KPI grid'i tam genişlik |

Genel: hiçbir ekran yatay taşma üretmez (`overflow-x: hidden` html'de
son savunma hattıdır, düzen buna yaslanmaz); uzun kelimeler
`overflow-wrap: anywhere` ile kırılır.

## 7. Ekran referansları

Canlı sözlü sürüm **`/design`** rotasındadır (`apps/web/app/design/page.tsx`);
her ekran için default/loading/empty/error wireframe panelleri içerir.
Özet:

**Alışveriş tarafı**

| Ekran | Rota | Kaynak | Düzen |
| --- | --- | --- | --- |
| Ortak katalog | `/` | canlı | arama + facet chip + 3'lü grid |
| Mağaza kataloğu | `/shop/[slug]` | canlı | markalı header + aynı grid |
| Ürün detay | `/products/[productId]` | canlı | 4:3 media + satın alma paneli + benzerler |
| Filtre/facet | `/` içinde | canlı | fieldset + `aria-pressed` chip + aktif filtre pill'leri |
| Kayıtlı ürünler | `/saved` | canlı (auth) | grid + kaldırma ikincil eylem |
| Profil / kategori tercihleri | rota planlı | **reference** | form kartı + kategori chip |

**Merchant dashboard**

| Ekran | Rota | Kaynak | Düzen |
| --- | --- | --- | --- |
| Özet | `/dashboard` | canlı (auth) | adım şeridi + next-action + 3'lü stat |
| Bağlantılar | `/dashboard/connections` | canlı (auth) | 6 adımlı sihirbaz + bağlantı kartları |
| Ürünler | `/dashboard/products` | canlı (auth) | liste + taslak/yayın + varyant |
| Katalog health | `/dashboard` paneli | canlı (auth) | satır rozetleri + sorun açıklaması |
| Satış ve komisyon | `/dashboard/analytics` | canlı (auth) | KPI + funnel + surface kırılımı |
| Ayarlar | rota planlı | **reference** | form primitive'leri |

Kurallar: `reference` etiketli düzenler bugün çalışan bir rota ifade
etmez; ÜRÜN-020/021 bu düzenleri bu primitive'lerle kurar. Hiçbir referans
gerçek olmayan satış/stok verisi göstermez.

## 8. ÜRÜN-020 ve ÜRÜN-021 için sınırlar

**ÜRÜN-020 (ChatGPT widget davranışı):**

- Widget CSS'i artık token'a bağlı (`apps/chatgpt-widget/src/styles.css`
  yalnız `@import "@shopai/ui/tokens.css"` + semantic var kullanımı).
  Host tema eşlemesi için tek iş: widget kökünde
  `data-shopai-theme` attribute'unu set etmek — CSS hazır.
- Kart hiyerarşisi `shopping-card-*` sınıfları korunmalı; sınıf adları
  davranış testlerinde de geçebilir (`tests/widget-shopping-state.test.ts`).
- Host bridge (`host-bridge.ts`) ve shopping state (`shopping-state.ts`)
  bu task'ta değişmedi; ÜRÜN-020 davranışı tasarlarken görsel katmana
  dokunmak için önce bu dosyayı değil token'ları okumalı.
- Loading/error/empty panelleri `.status-card/.empty-card` sınıflarıyla
  duruyor; istenirse `StateCard` markup'ına geçilebilir (ARIA aynı).

**ÜRÜN-021 (dashboard analytics):**

- Yeni metrik kartları `--shopai-space-*`, `--shopai-radius-*` ve durum
  renk üçlüsüyle kurulmalı; `analytics.module.css` içindeki
  `var(--background)` tipi tanımsız token kullanımı tekrarlanmamalı.
- Veri olmayan metrik: `StateCard variant="info"` ("Ölçülmüyor") veya
  empty — varsayım/sahte değer üretilemez.
- KPI grid'i `/design` → "Satış ve komisyon" stats wireframe'ini izler.

## 9. Doğrulama kanıtları

- **Kontrast:** `node scripts/design-contrast-report.mjs` → 50/50 ✓ (yukarıdaki tablo).
- **Responsive + tema screenshot'ları:** `node scripts/design-evidence.mjs`
  → `artifacts/urun-019/` altında storefront / design-reference / login /
  chatgpt-widget hedefleri için 320/390/1440 × light/dark PNG ve
  `report.json`. Son çalıştırma sonucu: **24/24 kombinasyon yatay taşma
  yok** (scrollWidth = viewport her kombinasyonda).
- **Görsel kabul incelemesi** screenshot'lar üzerinde yapıldı; bulunan ve
  düzeltilen sorunlar: (1) dark temada `--ink` tabanlı primary butonların
  sabit beyaz metni okunmuyordu → `--shopai-color-text-on-inverse`
  bağlandı; (2) `.start-state`/`.empty-state` sabit beyaz-alfa zemin
  dark'ta soluk blok oluşturuyordu → `--shopai-color-surface-muted`.
- Bilinen kısıtlar: login formu input'ları hâlâ default tarayıcı stilinde
  (auth task'iyla çakışmaması için bilinçli bırakıldı); dev modu Next.js
  göstergesi screenshot'larda görünür (production'a ait değil); widget
  screenshot'ları host-yok durumunu gösterir (host teması ÜRÜN-020).
- **CI kanıtı:** `ci.yml` içindeki `design-evidence` job'ı aynı script'i
  koşar ve `artifacts/urun-019/` çıktısını 90 gün saklanan
  `design-evidence-<run_id>` artifact'ı olarak yükler; PNG'ler repoya
  eklenmez.
- **Rota görünürlüğü:** `/design` production'da 404'tür; gating
  `DEPLOY_ENV` ortam değişkenini okur (compose dosyalarında zaten
  tanımlı) ve `tests/design-reference-gating.test.ts` ile birim
  testlidir. Staging'de ek yapılandırma gerekmez; dev sunucusunda da
  açıktır.

## 10. Bilinçli olarak yapılmayanlar

1. **9 legacy buton selektörünün tekilleştirilmesi** (`.search-button`,
   `.primary-link`, `.upload-card button` …): mevcut sayfalar bozulmasın
   diye bırakıldı; ileriye dönük stil `shopai-btn`'dir. Göç sonraki task.
2. **Ürün detay sayfası inline style refactoru** ve `/shop/[slug]` ↔
   `/stores/[slug]` birleşmesi — kapsamı UI sistemine değil yapıya çevirir.
3. **Widget TSX değişikliği** — yalnız CSS token'a bağlandı; markup ve
   davranış ÜRÜN-020'nin.
4. **Host teması yeniden tasarımı** — ÜRÜN-020 sınırı gereği yalnız
   attribute altyapısı hazırlandı.
5. **Skeleton'ların tüm sayfalara yayılması** — loading metinleri korundu;
   `Skeleton` primitive'i + kullanım kuralı teslim edildi.
6. **Auth/staging/DB/API değişikliği** — hiçbir auth dosyasına
   dokunulmadı (bkz. kapsam).
