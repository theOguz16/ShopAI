'use client';

import {
  type SavedProduct,
  savedProductsResponseSchema,
  unsaveProductResponseSchema,
} from '@shopai/contracts/saved-products';
import { useEffect, useState } from 'react';

const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';

export default function SavedProductsPage() {
  const [items, setItems] = useState<SavedProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [removingId, setRemovingId] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`${api}/v1/saved-products`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('saved_products_failed');
        const result = savedProductsResponseSchema.parse(await response.json());
        if (!controller.signal.aborted) setItems(result.items);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError('Kaydedilen ürünler şu anda yüklenemiyor.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  async function removeSaved(savedId: string) {
    if (removingId) return;
    setRemovingId(savedId);
    setError('');
    try {
      const response = await fetch(
        `${api}/v1/saved-products/${encodeURIComponent(savedId)}`,
        {
          method: 'DELETE',
          credentials: 'include',
        },
      );
      if (response.status === 404) {
        setItems((current) => current.filter((item) => item.id !== savedId));
        return;
      }
      if (!response.ok) throw new Error('unsave_product_failed');
      const result = unsaveProductResponseSchema.parse(await response.json());
      if (result.removed)
        setItems((current) => current.filter((item) => item.id !== savedId));
    } catch {
      setError('Ürün kayıttan çıkarılamadı. Yeniden deneyebilirsin.');
    } finally {
      setRemovingId('');
    }
  }

  return (
    <main className="store-shell">
      <header className="store-header">
        <a className="brand" href="/">
          ShopAI<span>●</span>
        </a>
        <a href="/">Alışverişe dön</a>
      </header>

      <section className="store-results" aria-labelledby="saved-title">
        <div>
          <p className="eyebrow">Alışveriş profilin</p>
          <h1 id="saved-title">Kaydedilenler</h1>
          <p>Web ve ChatGPT üzerinden kaydettiğin ürünler burada birleşir.</p>
        </div>

        {loading ? <p role="status">Kaydedilenler yükleniyor…</p> : null}
        {error ? <p role="alert">{error}</p> : null}
        {!loading && !error && !items.length ? (
          <p>Henüz kaydettiğin bir ürün yok.</p>
        ) : null}

        <ul className="product-grid">
          {items.map((item) => (
            <li key={item.id} className="product-card">
              {item.product?.imageUrl ? (
                <img
                  src={item.product.imageUrl}
                  alt={item.product.imageAlt ?? item.product.title}
                  className="product-image"
                />
              ) : (
                <div
                  className="product-image-placeholder"
                  role="img"
                  aria-label="Ürün görseli kullanılamıyor"
                >
                  ♡
                </div>
              )}
              <div className="product-card-body">
                <p className="eyebrow">
                  {item.product?.merchantName ?? 'Geçmiş kayıt'}
                </p>
                <h2 style={{ fontSize: 18 }}>
                  {item.product?.title ?? 'Artık kullanılamayan ürün'}
                </h2>
                {item.variant ? (
                  <p>
                    {item.variant.color} · {item.variant.size}
                  </p>
                ) : null}
                <p
                  className={
                    item.available
                      ? 'stock stock-in_stock'
                      : 'stock stock-out_of_stock'
                  }
                >
                  {item.available
                    ? 'Ürün hâlâ erişilebilir'
                    : 'Ürün artık erişilebilir değil — kayıt geçmişi korundu'}
                </p>
                {item.available ? (
                  <a
                    className="search-button"
                    href={`/products/${item.productId}`}
                    style={{ textAlign: 'center', textDecoration: 'none' }}
                  >
                    Ürünü aç
                  </a>
                ) : null}
                <button
                  type="button"
                  disabled={Boolean(removingId)}
                  onClick={() => void removeSaved(item.id)}
                >
                  {removingId === item.id ? 'Çıkarılıyor…' : 'Kayıttan çıkar'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
