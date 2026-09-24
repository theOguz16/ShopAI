# UI Envanteri ve Tutarsızlık Raporu (ÜRÜN-019 öncesi durum)

> Bu doküman ÜRÜN-019'un **read-only envanter** aşamasının çıktısıdır:
> tasarım sistemine geçilmeden önceki tekrarları ve tutarsızlıkları
> kaydeder. ÜRÜN-019'da neyin düzeltildiği, neyin bilinçli olarak
> bırakıldığı [`design-system.md`](design-system.md) §10'dadır.

## 1. Mimari durum

- **Web** (`apps/web`): Next 16.3.4 / React 19. Tek global `app/globals.css`
  (~911 satır, 8 token'lık `:root`) + 3 CSS Module (yalnız dashboard:
  analytics, catalog-health-panel, sync-progress-panel) + çok sayıda inline
  style (ürün detay, shop header'ları). Tailwind/CSS-in-JS yok.
- **Widget** (`apps/chatgpt-widget`): tek dosyalık React app
  (`src/main.tsx` ~857 satır) + tek global `src/styles.css` (~453 satır).
  Sıfır CSS değişkeni, 24 farklı hard-coded hex (~44 kullanım).
  `:root`'ta `color-scheme: light` sabit — host temasını yok sayar.
- **`@shopai/ui`**: yalnız `ProductCard` export eder, CSS'sizdir; stil
  tamamen web'in globals.css'ine muhtaçtır. Widget paketi dependency
  listesinde tutar ama **tek bir import yapmaz** — kartı kendi kopyasıdır.

## 2. Tekrar envanteri

| Öğe | Kopya sayısı | Yerler |
| --- | --- | --- |
| `colorLabels` sözlüğü | 3 | `app/page.tsx`, `products/[productId]/page.tsx`, `packages/ui` |
| Para formatlayıcı | 4 | `packages/ui`, `dashboard/products`, `products/[productId]`, analytics (`money`+`integer`) |
| Görsel fallback | 3+ | ui `ProductImage` (♧), `dashboard/products` `ProductThumb` (♧, sınıfsız), `saved` (♡ — farklı ikon) |
| Brand işareti markup'ı | 6 | her sayfa kendi `<a className="brand">` bloğunu yazar |
| Shell sınıfı | 4 | `.shop-shell` (1180), `.store-shell` (1180, farklı padding), `.dashboard-shell` (1120), analytics module `.page` (kendi kopyası) |
| Arama formu + sonuç grid + empty/error | 3 | `/`, `/shop/[slug]`, `/stores/[slug]` neredeyse birebir ikiz |
| Adım göstergesi | 2 | `OnboardingSteps` vs connections `.connector-wizard-steps` (farklı yapı) |

## 3. Tutarsızlık envanteri

### Butonlar
"Koyu primary buton" **9 ayrı selektörde** tekrar tanımlı, hepsi farklı
ölçüde: `.search-button` (radius 12), `.more-button` (10), `.error-state
button` (9), `.primary-link`/`.secondary-link`, `.upload-card button` +
`.connection-actions button` + `.panel-alert button` (aynı tanım 3 kez
gruplanmış), `.store-share button`, `.store-search button` (52px yüksek).
`.button-link` connections'ta kullanılıyor ama **CSS'te tanımsız**.
Stilsiz default browser butonu kalanlar: connections sihirbaz butonları,
`dashboard/products` tüm butonları, `saved` kaldırma, `login` girişi,
`products/[productId]` varyant/alarm butonları.

### Hata / uyarı / başarı kutuları
- Kırmızı ailesi 6 hex: `#8e2828` (tek token), `#9f2d20`, `#e4b5b5`,
  `#e7bbbb`, `#fff2f2`, `#fff1f1`.
- Sarı uyarı ailesi 4 ton: `#fff1b8`, `rgb(217 255 67 / 22%)`,
  `#4d3c00`, `#675300` (+ `#d1a300` çizgi).
- Yeşil ailesi 2+ ton: `#24643e` (stok), `#567200` (health), `#769600`,
  `#7c9d00`, `#516500`, `#5a7500` (focus).
- `.error-state` (storefront) ile `.panel-alert` (dashboard) görsel ikiz,
  farklı isim. `.success-note` ve `.error-note` connections'ta kullanılıp
  **tanımsız** (stil almıyor). `.empty-state` / `.store-empty` /
  `.panel-empty` / sınıfsız `<p role="status">` — 4 farklı empty yaklaşımı.

### Kırık referanslar (bug)
- `var(--background)` 3 CSS Module'de **5 kez** kullanılıyor ama hiçbir
  yerde tanımlı değil → zeminler çözümlenmiyor (analytics, catalog-health,
  sync-progress).
- Tanımsız sınıflar: `.connector-wizard-steps`, `.connector-wizard-card`,
  `.connector-choice`, `.success-note`, `.error-note`, `.button-link`,
  `.connection-list` — connections sayfası büyük ölçüde stilsizdi.
- `shop/[slug]`'da `--store-primary` set ediliyor ama tüketen CSS kuralı
  yok (ölü kod).

### Durum gösterimleri
- **Skeleton yok**: tüm loading'ler düz metin `<p role="status">`
  ("Mağaza yükleniyor…" aynı metin 2 dosyada elle).
- **Missing image** 3 yapı 2 ikon (♧/♡).
- **Stale** 3 temsil: `.stock-stale` rengi, connections
  "Güncel/Gecikmiş" düz metin, health `data-status="stale"` rozeti.
- **Success/error mesajları** sınıfsız `<p role="status|alert">` olarak
  karışıyor (dashboard/products başarı+hata aynı sınıfsız `<p>`).

## 4. Widget'ın fiili tasarım dili (korunacaklar)

"Off-white zemin + beyaz kart + koyu yeşilimsi ink `#172019` + pill chip +
18px radius + ince gri-yeşil kenarlık + 4:5 kart görseli". Bu dil ÜRÜN-019
ile korundu; sadece değerler token'a bağlandı. `shopping-card-*` sınıf
adları davranış testleriyle uyumlu olduğu için değiştirilmedi.

## 5. ÜRÜN-019'da yapılanlar (özet)

1. `packages/ui`'ye token sistemi (`tokens.css`, light+dark) ve durum
   primitive'leri (`states.tsx`/`states.css`: StateCard, Skeleton,
   ProductCardSkeleton, MissingImage, StockBadge, shopai-btn) eklendi;
   paylaşılan `format.ts` (colorLabels/formatMoney/formatDate) tekilleştirme
   için sunuldu.
2. Web globals.css: tüm hex'ler token'a bağlandı, eski 8 değişken alias'a
   çevrildi, 7 tanımsız sınıf tanımlandı, `var(--background)` bug'ı
   düzeltildi, dark tema layout.tsx script'iyle açıldı.
3. Widget styles.css: token'lara bağlandı (markup/davranış dokunulmadan),
   focus-visible ve reduced-motion eklendi.
4. `/design` referans sayfası + `docs/ui/design-system.md` + kontrast ve
   screenshot doğrulama script'leri.
