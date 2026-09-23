import {
  MissingImage,
  Skeleton,
  StateCard,
  StockBadge,
} from '@shopai/ui/states';
import type { Metadata } from 'next';
import { ThemeSwitch } from './theme-switch';
import './design.css';
import { ScreenStates, type ScreenLayout } from './wireframes';

export const metadata: Metadata = {
  title: 'ShopAI · Tasarım sistemi referansı (ÜRÜN-019)',
};

/*
 * ÜRÜN-019 referans sayfası. Bu sayfa ürün değildir: token'ları, ortak
 * durumları ve ekran düzenlerini ÜRÜN-020/021'in doğrudan uygulayabilmesi
 * için gösterir. Tüm örnek içerik reference/demo niteliğindedir; gerçek
 * ürün, mağaza veya satış verisi temsil etmez.
 */

const colorTokenGroups: {
  group: string;
  tokens: { name: string; use: string }[];
}[] = [
  {
    group: 'Yüzeyler',
    tokens: [
      { name: '--shopai-color-bg-page', use: 'Sayfa zemini' },
      { name: '--shopai-color-surface', use: 'Kart / panel yüzeyi' },
      {
        name: '--shopai-color-surface-muted',
        use: 'Soluk blok, görsel zemini',
      },
      { name: '--shopai-color-surface-raised', use: 'Yüzen kart / dropdown' },
      {
        name: '--shopai-color-surface-inverse',
        use: 'Ters bant (merchant switcher)',
      },
    ],
  },
  {
    group: 'Metin',
    tokens: [
      { name: '--shopai-color-text-primary', use: 'Başlık ve gövde' },
      { name: '--shopai-color-text-secondary', use: 'İkincil açıklama' },
      { name: '--shopai-color-text-muted', use: 'Yardım / zaman damgası' },
      {
        name: '--shopai-color-text-on-action',
        use: 'Primary buton üstü metin',
      },
    ],
  },
  {
    group: 'Eylem',
    tokens: [
      { name: '--shopai-color-action-primary', use: 'Primary buton zemini' },
      { name: '--shopai-color-action-primary-hover', use: 'Primary hover' },
      {
        name: '--shopai-color-action-secondary-bg',
        use: 'Secondary buton zemini',
      },
      { name: '--shopai-color-action-disabled-bg', use: 'Disabled zemin' },
    ],
  },
  {
    group: 'Durum',
    tokens: [
      { name: '--shopai-color-success-text', use: 'Başarı metni' },
      { name: '--shopai-color-success-bg', use: 'Başarı zemini' },
      { name: '--shopai-color-warning-text', use: 'Uyarı metni' },
      { name: '--shopai-color-warning-bg', use: 'Uyarı zemini' },
      { name: '--shopai-color-error-text', use: 'Hata metni' },
      { name: '--shopai-color-error-bg', use: 'Hata zemini' },
      { name: '--shopai-color-info-text', use: 'Bilgi metni' },
      { name: '--shopai-color-info-bg', use: 'Bilgi zemini' },
    ],
  },
  {
    group: 'Kenarlık ve odak',
    tokens: [
      { name: '--shopai-color-border', use: 'Normal kenarlık' },
      { name: '--shopai-color-border-strong', use: 'Belirgin kenarlık (3:1)' },
      { name: '--shopai-color-focus-ring', use: 'Keyboard focus halkası' },
    ],
  },
  {
    group: 'Stok (daima etiketle birlikte)',
    tokens: [
      { name: '--shopai-color-stock-in-stock', use: 'Stokta' },
      { name: '--shopai-color-stock-out-of-stock', use: 'Tükendi' },
      { name: '--shopai-color-stock-unknown', use: 'Bilinmiyor' },
      { name: '--shopai-color-stock-stale', use: 'Bayat veri' },
    ],
  },
];

const spacingScale = [
  '--shopai-space-1 (4px)',
  '--shopai-space-2 (8px)',
  '--shopai-space-3 (12px)',
  '--shopai-space-4 (16px)',
  '--shopai-space-5 (20px)',
  '--shopai-space-6 (24px)',
  '--shopai-space-8 (32px)',
  '--shopai-space-10 (40px)',
  '--shopai-space-12 (48px)',
];

const radiusScale = [
  '--shopai-radius-sm (8px) — chip, küçük bloklar',
  '--shopai-radius-md (10px) — buton, input',
  '--shopai-radius-lg (14px) — durum kartı',
  '--shopai-radius-xl (18px) — ürün kartı, panel',
  '--shopai-radius-2xl (24px) — hero/next-action',
  '--shopai-radius-pill (999px) — chip, rozet',
];

const typeScale = [
  '--shopai-font-size-2xs (11px) — kart üstü merchant etiketi',
  '--shopai-font-size-xs (12px) — yardım, meta',
  '--shopai-font-size-sm (13px) — ikincil',
  '--shopai-font-size-md (14px) — kart başlığı',
  '--shopai-font-size-base (16px) — gövde',
  '--shopai-font-size-lg (18px) — kart fiyatı',
  '--shopai-font-size-2xl (24px) — detay fiyatı',
  '--shopai-font-size-3xl (32px) — istatistik değeri',
];

type ScreenSpec = {
  key: string;
  title: string;
  area: 'shopping' | 'merchant';
  route: string;
  source: 'live' | 'reference';
  layout: ScreenLayout;
  note: string;
  emptyTitle: string;
  errorDescription: string;
};

const screens: ScreenSpec[] = [
  {
    key: 'ortak-katalog',
    title: 'Ortak katalog (arama + sonuçlar)',
    area: 'shopping',
    route: '/',
    source: 'live',
    layout: 'grid',
    note: 'Doğal dil arama + fiyat/sıralama kontrolleri, facet chip satırı, 3 kolonlu ürün grid’i. Demo ürünler varsa Demo rozetiyle ayrışır.',
    emptyTitle: 'Bu aramaya uygun ürün bulunamadı',
    errorDescription:
      'Sonuçlar yüklenemedi. Yeniden dene eylemi sağ üstte durur.',
  },
  {
    key: 'magaza-katalogu',
    title: 'Mağaza kataloğu',
    area: 'shopping',
    route: '/shop/[slug]',
    source: 'live',
    layout: 'grid',
    note: 'Markalı storefront: kapak, mağaza adı, mağaza + ağ arama sekmeleri. Sonuç grid’i ortak katalogla aynı primitive’leri kullanır.',
    emptyTitle: 'Bu mağazada aramanla eşleşen ürün yok',
    errorDescription: 'Mağaza kataloğu yüklenemedi.',
  },
  {
    key: 'urun-detay',
    title: 'Ürün detay',
    area: 'shopping',
    route: '/products/[productId]',
    source: 'live',
    layout: 'detail',
    note: '4:3 görsel + fiyat/stok paneli, varyant chip’leri (aria-pressed), kaydet/alarm eylemleri, benzer ürünler grid’i.',
    emptyTitle: 'Ürün bulunamadı',
    errorDescription: 'Ürün verisi yüklenemedi.',
  },
  {
    key: 'filtre-facet',
    title: 'Filtre / facet görünümü',
    area: 'shopping',
    route: '/ (facet bölümü)',
    source: 'live',
    layout: 'grid',
    note: 'Facet’ler fieldset + aria-pressed chip’lerdir; aktif filtre pill’leri sonuç listesinin üstünde kaldırılabilir durumdadır. Mobilde tek kolona düşer.',
    emptyTitle: 'Bu filtrelerle sonuç yok',
    errorDescription: 'Facet verisi yüklenemedi.',
  },
  {
    key: 'kayitli-urunler',
    title: 'Kayıtlı ürünler',
    area: 'shopping',
    route: '/saved',
    source: 'live',
    layout: 'grid',
    note: 'Girişli kullanıcı listesi. Kayıttan çıkarma birincil değil ikincil eylemdir; stok rozetleri StateCard kurallarını izler.',
    emptyTitle: 'Henüz kaydettiğin ürün yok',
    errorDescription: 'Kayıtlı ürünler yüklenemedi.',
  },
  {
    key: 'profil-tercihler',
    title: 'Profil / kategori tercihleri',
    area: 'shopping',
    route: 'rota planlı — bugün uygulamada yok',
    source: 'reference',
    layout: 'form',
    note: 'Reference: rota henüz yok. Düzen; kategori chip seçimleri ve kaydet eylemi olan form kartıdır. Uygulandığında bu primitive set kullanılır.',
    emptyTitle: 'Henüz tercih seçmedin',
    errorDescription: 'Tercihler kaydedilemedi.',
  },
  {
    key: 'dashboard-ozet',
    title: 'Merchant dashboard özeti',
    area: 'merchant',
    route: '/dashboard',
    source: 'live',
    layout: 'stats',
    note: 'Onboarding adım şeridi, sıradaki adım kartı, Catalog Health paneli ve 3’lü istatistik. Görüntüleyici yetkisinde role-note (uyarı varyantı) gösterilir.',
    emptyTitle: 'Bağlı mağaza bulunamadı',
    errorDescription: 'Dashboard verisi yüklenemedi.',
  },
  {
    key: 'dashboard-baglantilar',
    title: 'Bağlantılar',
    area: 'merchant',
    route: '/dashboard/connections',
    source: 'live',
    layout: 'form',
    note: '6 adımlı connector sihirbazı + mevcut bağlantı kartları. Adım şeridi, tazelik etiketi ve reauthorization uyarısı StateCard warning ile gösterilir.',
    emptyTitle: 'Henüz bağlantı yok',
    errorDescription: 'Bağlantı durumu yüklenemedi.',
  },
  {
    key: 'dashboard-urunler',
    title: 'Ürünler',
    area: 'merchant',
    route: '/dashboard/products',
    source: 'live',
    layout: 'list',
    note: 'Taslak/yayın yönetimi, varyant detayı, küçük ürün görselleri (MissingImage fallback’i ile). Satır durumu rozetle + metinle taşınır.',
    emptyTitle: 'Katalogda henüz ürün yok',
    errorDescription: 'Katalog yüklenemedi.',
  },
  {
    key: 'katalog-health',
    title: 'Katalog health / sorunlar',
    area: 'merchant',
    route: '/dashboard (Catalog Health paneli)',
    source: 'live',
    layout: 'list',
    note: 'Sağlıklı/bayat/sorunlu satır rozetleri; sorunlu satırlar hata açıklaması ve önerilen aksiyonla listelenir. Renk tek başına anlam taşımaz.',
    emptyTitle: 'Katalog sorunsuz görünüyor',
    errorDescription: 'Katalog sağlık verisi yüklenemedi.',
  },
  {
    key: 'satis-komisyon',
    title: 'Satış ve komisyon',
    area: 'merchant',
    route: '/dashboard/analytics',
    source: 'live',
    layout: 'stats',
    note: 'KPI kartları, session funnel, surface kırılımı. Ölçülmeyen metrikler varsayım ÜRETMEZ: empty/info durumuyla “ölçülmüyor” etiketi taşır.',
    emptyTitle: 'Bu dönemde ölçülen veri yok',
    errorDescription: 'Analitik verisi yüklenemedi.',
  },
  {
    key: 'ayarlar',
    title: 'Ayarlar',
    area: 'merchant',
    route: 'rota planlı — bugün uygulamada yok',
    source: 'reference',
    layout: 'form',
    note: 'Reference: ayrı ayarlar ekranı henüz yok. Bugün mağaza paylaşım kartı /dashboard içindedir. Uygulandığında form primitive’leri buradaki gibidir.',
    emptyTitle: 'Ayarlar yüklenemedi',
    errorDescription: 'Ayarlar kaydedilemedi.',
  },
];

export default function DesignSystemPage() {
  return (
    <main className="ds-page">
      <header className="ds-header">
        <a className="brand" href="/">
          ShopAI<span>●</span>
        </a>
        <ThemeSwitch />
      </header>

      <p className="eyebrow">ÜRÜN-019 · Referans</p>
      <h1>Tasarım sistemi</h1>
      <p className="ds-intro">
        Semantic token’lar, ortak UI durumları ve ekran düzenlerinin tek
        kaynağı. Sürüm 1.0 — token tanımları{' '}
        <code>packages/ui/src/tokens.css</code> içindedir; bu sayfa onun canlı
        görüntüsüdür. Buradaki tüm örnek veriler reference etiketlidir, gerçek
        satış/stok verisi temsil etmez.
      </p>

      <ul className="ds-subnav">
        <li>
          <a href="#tokenlar">Token’lar</a>
        </li>
        <li>
          <a href="#bilesenler">Bileşenler ve durumlar</a>
        </li>
        <li>
          <a href="#ekranlar">Ekran referansları</a>
        </li>
        <li>
          <a href="#responsive">Responsive ve erişilebilirlik</a>
        </li>
        <li>
          <a href="#sinirlar">ÜRÜN-020/021 sınırları</a>
        </li>
      </ul>

      <section id="tokenlar" className="ds-section">
        <h2>Token’lar</h2>
        <p className="ds-section-note">
          İsimler semantic’tir (ne için, hangi renk değil). Light varsayılandır;
          dark tema <code>data-shopai-theme="dark"</code> attribute’u ile açılır
          — yukarıdaki değiştiriciyle dene. Widget aynı token setini{' '}
          <code>@shopai/ui/tokens.css</code> üzerinden paylaşır.
        </p>
        {colorTokenGroups.map((g) => (
          <div key={g.group}>
            <h3 className="ds-h3">{g.group}</h3>
            <div className="ds-token-grid">
              {g.tokens.map((t) => (
                <div className="ds-token" key={t.name}>
                  <span
                    className="ds-token-swatch"
                    style={{ background: `var(${t.name})` }}
                    aria-hidden="true"
                  />
                  <div>
                    <div className="ds-token-name">{t.name}</div>
                    <p className="ds-token-use">{t.use}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}

        <h3 className="ds-h3">Spacing</h3>
        <ul className="ds-scale">
          {spacingScale.map((s) => (
            <li key={s}>
              <code>{s}</code>
            </li>
          ))}
        </ul>

        <h3 className="ds-h3">Radius</h3>
        <ul className="ds-scale">
          {radiusScale.map((s) => (
            <li key={s}>
              <code>{s}</code>
            </li>
          ))}
        </ul>

        <h3 className="ds-h3">Tipografi</h3>
        <ul className="ds-scale">
          {typeScale.map((s) => (
            <li key={s}>
              <code>{s}</code>
            </li>
          ))}
        </ul>
      </section>

      <section id="bilesenler" className="ds-section">
        <h2>Bileşenler ve ortak durumlar</h2>
        <p className="ds-section-note">
          Primitive’ler <code>packages/ui</code> içinden gelir (StateCard,
          Skeleton, StockBadge, MissingImage, shopai-btn). Yalnız renkyle bilgi
          verilmez: her durum rozet/dot + okunur etiket taşır.
        </p>

        <h3 className="ds-h3">Butonlar</h3>
        <div className="ds-component-row">
          <button type="button" className="shopai-btn shopai-btn--primary">
            Primary
          </button>
          <button type="button" className="shopai-btn shopai-btn--secondary">
            Secondary
          </button>
          <button type="button" className="shopai-btn shopai-btn--ghost">
            Ghost
          </button>
          <button
            type="button"
            className="shopai-btn shopai-btn--primary"
            disabled
          >
            Disabled
          </button>
          <button type="button" className="ds-chip" aria-pressed="true">
            Seçili chip
          </button>
          <button type="button" className="ds-chip">
            Chip
          </button>
        </div>

        <h3 className="ds-h3">Form alanları</h3>
        <div className="ds-component-row">
          <div className="ds-field">
            <label htmlFor="ds-demo-input">Arama</label>
            <input id="ds-demo-input" placeholder="ör. siyah tişört" />
          </div>
          <div className="ds-field ds-field-error">
            <label htmlFor="ds-demo-error">Fiyat üst sınırı</label>
            <input id="ds-demo-error" defaultValue="abc" />
            <p className="ds-field-error-text">
              Hata: sayı girmelisin — hata metni renkle değil yazıyla da
              taşınır.
            </p>
          </div>
        </div>

        <h3 className="ds-h3">Stok rozetleri</h3>
        <div className="ds-badge-row">
          <StockBadge status="in_stock" />
          <StockBadge status="out_of_stock" />
          <StockBadge status="unknown" />
          <StockBadge status="stale" />
          <span className="demo-badge">Demo ürün</span>
        </div>

        <h3 className="ds-h3">Durum kartı (StateCard)</h3>
        <div className="wf-state-grid">
          <StateCard variant="loading" title="Ürünler yükleniyor…" />
          <StateCard
            variant="empty"
            title="Sonuç yok"
            description="Aramayı genişletmeyi dene."
          />
          <StateCard
            variant="error"
            title="Veri alınamadı"
            description="Ağ hatası. Yeniden dene eylemi burada sunulur."
          />
          <StateCard
            variant="warning"
            title="Veri bayat olabilir"
            description="Son senkron 3 gün önce; değerler garanti edilmez."
          />
          <StateCard
            variant="success"
            title="Bağlantı kuruldu"
            description="İlk senkron kuyruğa alındı."
          />
          <StateCard
            variant="info"
            title="Ölçülmüyor"
            description="Bu metodoloji etkinleştirilene kadar veri üretilmez."
          />
          <StateCard
            variant="permission"
            title="Görüntüleyici yetkin var"
            description="Bu eylem için editör yetkisi gerekir."
          />
        </div>

        <h3 className="ds-h3">Skeleton</h3>
        <div className="wf-cards" style={{ maxWidth: 420 }} aria-hidden="true">
          <Skeleton style={{ height: 90 }} />
          <Skeleton style={{ height: 90 }} />
        </div>

        <h3 className="ds-h3">Görsel placeholder (missing image)</h3>
        <div className="wf-detail" style={{ maxWidth: 420 }}>
          <div style={{ aspectRatio: '4 / 3', display: 'grid' }}>
            <MissingImage label="Örnek ürün görseli yok" />
          </div>
          <div className="wf-stack">
            <p className="ds-token-use">
              Görsel yüklenemezse veya hiç yoksa: nötr yüzey + ♧ işareti +{' '}
              <code>role="img"</code> aria-label (“X görseli yok”). Kartlar asla
              boş beyaz alan bırakmaz.
            </p>
          </div>
        </div>
      </section>

      <section id="ekranlar" className="ds-section">
        <h2>Ekran referansları</h2>
        <p className="ds-section-note">
          Her ekran için default / loading / empty / error düzeni. “Canlı”
          etiketi bugün uygulamada olan rotayı, “reference” etiketi henüz
          olmayan ama ÜRÜN-020/021’in izleyeceği düzeni gösterir.
        </p>
        {(['shopping', 'merchant'] as const).map((area) => (
          <div key={area}>
            <h3 className="ds-h3">
              {area === 'shopping' ? 'Alışveriş tarafı' : 'Merchant dashboard'}
            </h3>
            {screens
              .filter((s) => s.area === area)
              .map((s) => (
                <article className="ds-screen" key={s.key}>
                  <div className="ds-screen-head">
                    <h3>{s.title}</h3>
                    <span className="ds-route">{s.route}</span>
                    <span className={`ds-source ds-source--${s.source}`}>
                      {s.source === 'live' ? 'canlı' : 'reference'}
                    </span>
                  </div>
                  <p className="ds-screen-note">{s.note}</p>
                  <ScreenStates
                    layout={s.layout}
                    emptyTitle={s.emptyTitle}
                    errorDescription={s.errorDescription}
                  />
                </article>
              ))}
          </div>
        ))}
      </section>

      <section id="responsive" className="ds-section">
        <h2>Responsive ve erişilebilirlik</h2>
        <p className="ds-section-note">
          Doğrulama: <code>scripts/design-evidence.mjs</code> 320 / 390 / 1440
          genişliklerinde ana ekranları tarar, yatay taşma (scrollWidth &gt;
          viewport) varsa raporlar ve screenshot üretir.
        </p>
        <table className="ds-table">
          <thead>
            <tr>
              <th>Genişlik</th>
              <th>Kural</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>320px</code>
              </td>
              <td>
                Tek kolon grid; filtre/form kontrolleri dikey dizilir; header
                sarar; yatay taşma kabul edilmez.
              </td>
            </tr>
            <tr>
              <td>
                <code>390px</code>
              </td>
              <td>
                Storefront ürün grid’i 2 kolon; widget grid’i 2 kolon (380px
                altında 1); dashboard kartları tek kolon.
              </td>
            </tr>
            <tr>
              <td>
                <code>1440px</code>
              </td>
              <td>
                Shell üst sınırı 1120–1180px; ürün grid’i 3 kolon; facet satırı
                3’lü; analytics KPI grid’i tam genişlik.
              </td>
            </tr>
          </tbody>
        </table>
        <p className="ds-section-note" style={{ marginTop: 16 }}>
          Erişilebilirlik: normal metin ≥ 4.5:1, UI bileşeni/odak ≥ 3:1 (
          <code>node scripts/design-contrast-report.mjs</code> token’ları
          doğrular). Keyboard focus her etkileşimli öğede görünür 3px halkadır.
          <code>prefers-reduced-motion</code> altında tüm animasyonlar
          kapatılır. Hata/uyarı/başarı metinleri renkle değil yazıyla da
          taşınır; stok durumu daima nokta + etiket gösterir.
        </p>
      </section>

      <section id="sinirlar" className="ds-section">
        <h2>ÜRÜN-020 ve ÜRÜN-021 sınırları</h2>
        <div className="ds-component-row" style={{ alignItems: 'flex-start' }}>
          <StateCard
            variant="info"
            title="ÜRÜN-020 (widget)"
            description={
              <>
                Host tema eşlemesi <code>data-shopai-theme</code> attribute’u
                üzerinden yapılır; <code>shopping-card-*</code> sınıfları artık
                token’a bağlıdır. Host bridge ve alışveriş state mantığı bu
                task’ta değişmedi — widget TSX’e dokunulmadı.
              </>
            }
          />
          <StateCard
            variant="info"
            title="ÜRÜN-021 (dashboard)"
            description="Analitik ekranları bu token setini ve StateCard durumlarını kullanır. Gerçek veri olmayan metrik boş/info durumunda kalır; varsayım veri üretilmez."
          />
        </div>
        <h3 className="ds-h3">Bu taskta bilinçli olarak yapılmayanlar</h3>
        <ul className="ds-scale">
          <li>
            9 farklı legacy buton selektörünün tekilleştirilmesi — shopai-btn
            sunuldu, mevcut sayfalar sonraki tasklerde göçer.
          </li>
          <li>Ürün detay sayfasındaki inline style’ların refactoru.</li>
          <li>/shop/[slug] ve /stores/[slug] sayfalarının birleştirilmesi.</li>
          <li>Widget TSX/markup değişiklikleri (yalnız CSS token bağlandı).</li>
          <li>
            Auth ekranlarının ve staging konfigürasyonunun değiştirilmesi.
          </li>
        </ul>
      </section>
    </main>
  );
}
