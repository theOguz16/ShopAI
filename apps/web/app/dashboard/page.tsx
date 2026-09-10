'use client';

import { useCallback, useEffect, useState } from 'react';
import { useActiveMerchant } from './merchant-context';
import { OnboardingSteps } from './onboarding-steps';

const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';
type Summary = {
  connections: number;
  hasWooCommerce: boolean;
  imports: number;
  products: number;
  published: number;
};

export default function Dashboard() {
  const { activeMerchant, merchantId } = useActiveMerchant();
  const [summary, setSummary] = useState<Summary>();
  const [error, setError] = useState('');
  const [copyMessage, setCopyMessage] = useState('');
  const load = useCallback(
    async (signal?: AbortSignal) => {
      setError('');
      try {
        const responses = await Promise.all([
          fetch(`${api}/v1/merchants/${merchantId}/connections`, {
            credentials: 'include',
            signal,
          }),
          fetch(`${api}/v1/merchants/${merchantId}/imports`, {
            credentials: 'include',
            signal,
          }),
          fetch(`${api}/v1/merchants/${merchantId}/products`, {
            credentials: 'include',
            signal,
          }),
        ]);
        if (!responses.every((item) => item.ok))
          throw new Error('summary_failed');
        const [connections, imports, products] = await Promise.all(
          responses.map((item) => item.json()),
        );
        const hasWooCommerce = connections.some(
          (connection: { provider?: string; active?: boolean }) =>
            connection.provider === 'woocommerce' &&
            connection.active !== false,
        );
        if (!signal?.aborted)
          setSummary({
            connections: connections.length,
            hasWooCommerce,
            imports: imports.length,
            products: products.length,
            published: products.filter(
              (product: { published: boolean }) => product.published,
            ).length,
          });
      } catch {
        if (!signal?.aborted)
          setError('Kurulum durumu yüklenemedi. Yeniden deneyebilirsin.');
      }
    },
    [merchantId],
  );
  useEffect(() => {
    const controller = new AbortController();
    setSummary(undefined);
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const dataTransferred = Boolean(
    summary &&
      (summary.imports > 0 || (summary.hasWooCommerce && summary.products > 0)),
  );
  const current = !summary?.connections
    ? 'connect'
    : !dataTransferred
      ? 'import'
      : !summary.products
        ? 'review'
        : !summary.published
          ? 'publish'
          : 'view';
  const completed = summary
    ? [
        ...(summary.connections ? ['connect' as const] : []),
        ...(dataTransferred ? ['import' as const] : []),
        ...(summary.products ? ['review' as const] : []),
        ...(summary.published ? ['publish' as const] : []),
      ]
    : [];
  const importAction = summary?.hasWooCommerce
    ? {
        href: '/dashboard/connections',
        title: 'İlk WooCommerce senkronunu tamamla',
        text: 'Bağlantın oluşturuldu. İlk ürün aktarımının sonucunu bağlantılar ekranından takip et; CSV yüklemen gerekmiyor.',
        action: 'Senkron durumunu aç',
      }
    : {
        href: '/dashboard/imports',
        title: 'Şimdi ürünlerini aktar',
        text: 'Şablonu indir, kendi ürün bilginle doldur ve dosyayı yükle.',
        action: 'CSV yükle',
      };
  const actions = {
    connect: {
      href: '/dashboard/connections',
      title: 'Mağazanı bir ürün kaynağına bağla',
      text: 'WooCommerce mağaza adresini ve API bilgilerini gir; bağlantıyı ShopAI içinden test edip ilk senkronu başlatabilirsin.',
      action: 'Mağazanı bağla',
    },
    import: importAction,
    review: {
      href: '/dashboard/products',
      title: 'Aktarılan ürünleri kontrol et',
      text: 'Beden, renk, fiyat ve mağaza bağlantısını yayımlamadan önce gözden geçir.',
      action: 'Ürünleri kontrol et',
    },
    publish: {
      href: '/dashboard/products',
      title: 'İlk ürününü yayımla',
      text: 'Kontrol ettiğin taslağı alışveriş aramasında görünür yap.',
      action: 'Taslakları aç',
    },
    view: {
      href: `/stores/${activeMerchant.slug}`,
      title: 'Mağazan hazır',
      text: 'Yayımlanan ürünlerinin alışveriş deneyiminde nasıl göründüğünü kontrol et.',
      action: 'Mağazanı görüntüle',
    },
  }[current];

  async function copyStoreLink() {
    try {
      await navigator.clipboard.writeText(
        new URL(`/stores/${activeMerchant.slug}`, window.location.origin).href,
      );
      setCopyMessage('Mağaza bağlantısı kopyalandı.');
    } catch {
      setCopyMessage(
        'Bağlantı kopyalanamadı. Mağazayı açıp adres çubuğundan kopyalayabilirsin.',
      );
    }
  }

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">{activeMerchant.name}</p>
          <h1>Mağazanı yayına hazırla</h1>
        </div>
        <nav>
          <a href="/">Kataloğa dön</a>
          <a href="/login">Oturum değiştir</a>
        </nav>
      </header>
      <OnboardingSteps current={current} completed={completed} />
      {error ? (
        <div className="panel-alert" role="alert">
          <p>{error}</p>
          <button type="button" onClick={() => void load()}>
            Yeniden dene
          </button>
        </div>
      ) : null}
      {!summary && !error ? (
        <p role="status">Mağaza durumu kontrol ediliyor…</p>
      ) : null}
      {summary ? (
        <section className="next-action">
          <p className="eyebrow">Sıradaki adım</p>
          <h2>{actions.title}</h2>
          <p>{actions.text}</p>
          {activeMerchant.role === 'viewer' && current !== 'view' ? (
            <p className="role-note">
              Görüntüleyici yetkin var. Bu adımı mağaza sahibi veya editör
              tamamlayabilir.
            </p>
          ) : (
            <a className="primary-link" href={actions.href}>
              {actions.action} →
            </a>
          )}
        </section>
      ) : null}
      <section className="dashboard-stats" aria-label="Katalog özeti">
        <div>
          <strong>{summary?.connections ?? '—'}</strong>
          <span>bağlı kaynak</span>
        </div>
        <div>
          <strong>{summary?.products ?? '—'}</strong>
          <span>ürün</span>
        </div>
        <div>
          <strong>{summary?.published ?? '—'}</strong>
          <span>yayında</span>
        </div>
      </section>
      <section className="store-share">
        <div>
          <h2>Müşterilerinle paylaş</h2>
          <p>
            Bu bağlantı oturum açmadan yalnızca yayımlanmış ürünlerini gösterir.
          </p>
        </div>
        <div>
          <a className="secondary-link" href={`/stores/${activeMerchant.slug}`}>
            Mağazanı görüntüle
          </a>
          <button type="button" onClick={() => void copyStoreLink()}>
            Bağlantıyı kopyala
          </button>
        </div>
        {copyMessage ? <p role="status">{copyMessage}</p> : null}
      </section>
    </main>
  );
}
