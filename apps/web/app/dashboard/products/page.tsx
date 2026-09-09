'use client';

import { type StockStatus, stockStatusLabel } from '@shopai/contracts';
import { useCallback, useEffect, useState } from 'react';
import { useActiveMerchant } from '../merchant-context';
import { OnboardingSteps } from '../onboarding-steps';

const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';

type Variant = {
  id: string;
  size: string;
  color: string;
  offer: {
    priceMinor: number;
    currency: string;
    checkoutUrl: string;
    observedAt: string;
    priceSource?: string;
    inventory: {
      available: boolean | null;
      observedAt: string;
      stockSource?: string;
      stockStatus: StockStatus;
    } | null;
  } | null;
};
type Product = {
  id: string;
  title: string;
  description: string;
  category: string;
  imageUrl: string | null;
  imageAlt: string | null;
  published: boolean;
  publicationChangedAt: string | null;
  variants: Variant[];
};

function money(minor: number, currency: string) {
  return new Intl.NumberFormat('tr-TR', {
    style: 'currency',
    currency,
  }).format(minor / 100);
}

function ProductThumb({ product }: { product: Product }) {
  const [failed, setFailed] = useState(false);
  if (failed || !product.imageUrl)
    return (
      <span role="img" aria-label="Görsel yok">
        ♧
      </span>
    );
  return (
    // biome-ignore lint/performance/noImgElement: external merchant images need an onError fallback.
    <img
      src={product.imageUrl}
      alt={product.imageAlt ?? product.title}
      width={72}
      height={72}
      onError={() => setFailed(true)}
      style={{ objectFit: 'cover', borderRadius: 8 }}
    />
  );
}

export default function ProductsPage() {
  const { merchantId, activeMerchant } = useActiveMerchant();
  const canEdit = activeMerchant.role !== 'viewer';
  const [products, setProducts] = useState<Product[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      if (!merchantId) return;
      const response = await fetch(
        `${api}/v1/merchants/${merchantId}/products`,
        {
          credentials: 'include',
          signal,
        },
      );
      if (response.ok && !signal?.aborted) setProducts(await response.json());
      else if (!signal?.aborted)
        setMessage(
          'Ürünler yüklenemedi. Oturum veya mağaza seçimini kontrol et.',
        );
    },
    [merchantId],
  );
  useEffect(() => {
    const controller = new AbortController();
    setProducts([]);
    setSelected([]);
    setExpanded(null);
    setMessage('');
    void refresh(controller.signal).catch(() => {
      if (!controller.signal.aborted) setMessage('Ürünler yüklenemedi.');
    });
    return () => controller.abort();
  }, [refresh]);

  async function changePublication(ids: string[], published: boolean) {
    if (!canEdit || !merchantId || !ids.length) return;
    const response = await fetch(
      `${api}/v1/merchants/${merchantId}/products/publication`,
      {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ productIds: ids, published }),
      },
    );
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setMessage(`Yayın işlemi başarısız: ${body.code ?? response.status}`);
      return;
    }
    setSelected([]);
    setMessage(published ? 'Ürün yayımlandı.' : 'Ürün yayından kaldırıldı.');
    await refresh();
  }

  return (
    <main className="dashboard-shell">
      <nav className="subnav">
        <a href="/dashboard">← Panele dön</a>
        <a href="/dashboard/imports">CSV importları</a>
      </nav>
      <OnboardingSteps current="review" completed={['connect', 'import']} />
      <h1>Ürün kataloğu</h1>
      <p>
        Taslaklar yalnızca burada görünür; public aramada yayın onaylı ürünler
        yer alır.
      </p>
      {message ? <p role="status">{message}</p> : null}
      {canEdit ? (
        <div>
          <button
            type="button"
            disabled={!selected.length}
            onClick={() => void changePublication(selected, true)}
          >
            Seçilenleri yayımla
          </button>{' '}
          <button
            type="button"
            disabled={!selected.length}
            onClick={() => void changePublication(selected, false)}
          >
            Seçilenleri yayından kaldır
          </button>
        </div>
      ) : (
        <p className="role-note">
          Görüntüleyici yetkin var. Ürünleri inceleyebilir, yayın durumunu
          değiştiremezsin.
        </p>
      )}
      <ul>
        {products.map((product) => {
          return (
            <li key={product.id} style={{ margin: '18px 0' }}>
              <ProductThumb product={product} />{' '}
              {canEdit ? (
                <label>
                  <input
                    type="checkbox"
                    checked={selected.includes(product.id)}
                    onChange={(event) =>
                      setSelected((current) =>
                        event.target.checked
                          ? [...current, product.id]
                          : current.filter((id) => id !== product.id),
                      )
                    }
                  />{' '}
                  <strong>{product.title}</strong>
                </label>
              ) : (
                <strong>{product.title}</strong>
              )}{' '}
              <span>{product.published ? 'Yayında' : 'Taslak'}</span>{' '}
              <button
                type="button"
                onClick={() =>
                  setExpanded(expanded === product.id ? null : product.id)
                }
              >
                {expanded === product.id ? 'Detayı gizle' : 'Detay'}
              </button>
              {canEdit ? (
                <button
                  type="button"
                  onClick={() =>
                    void changePublication([product.id], !product.published)
                  }
                >
                  {product.published ? 'Yayından kaldır' : 'Yayımla'}
                </button>
              ) : null}
              <p>
                {product.variants.length} varyant · Fiyat ve stok her varyant
                için ayrı gösterilir.
              </p>
              {expanded === product.id ? (
                <div>
                  <p>{product.description}</p>
                  <p>Kategori: {product.category}</p>
                  <p>Görsel alt metni: {product.imageAlt || 'yok'}</p>
                  <ul>
                    {product.variants.map((item) => (
                      <li key={item.id}>
                        {item.size} / {item.color}:{' '}
                        {item.offer
                          ? `${money(item.offer.priceMinor, item.offer.currency)} · ${item.offer.inventory ? stockStatusLabel(item.offer.inventory.stockStatus) : stockStatusLabel('unknown')}`
                          : 'Fiyat ve stok bilgisi yok'}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </main>
  );
}
