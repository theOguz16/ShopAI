'use client';

import { stockStatusLabel } from '@shopai/contracts';
import {
  type ProductDetailResponse,
  productDetailResponseSchema,
} from '@shopai/contracts/product-detail';
import { ProductCard } from '@shopai/ui';
import { useParams, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';

const colorLabels: Record<string, string> = {
  black: 'Siyah',
  white: 'Beyaz',
  navy: 'Lacivert',
  blue: 'Mavi',
  red: 'Kırmızı',
  green: 'Yeşil',
};

function money(minor: number, currency: 'TRY') {
  return new Intl.NumberFormat('tr-TR', {
    style: 'currency',
    currency,
  }).format(minor / 100);
}

export default function ProductDetailPage() {
  const { productId } = useParams<{ productId: string }>();
  const searchParams = useSearchParams();
  const [detail, setDetail] = useState<ProductDetailResponse>();
  const [selectedColor, setSelectedColor] = useState('');
  const [selectedVariantId, setSelectedVariantId] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams();
    const searchId = searchParams.get('searchId');
    const discoverySessionId = searchParams.get('discoverySessionId');
    if (searchId) query.set('searchId', searchId);
    if (discoverySessionId)
      query.set('discoverySessionId', discoverySessionId);
    const suffix = query.size ? `?${query.toString()}` : '';

    setLoading(true);
    setMissing(false);
    setError('');
    void fetch(
      `${api}/v1/products/${encodeURIComponent(productId)}/detail${suffix}`,
      { signal: controller.signal },
    )
      .then(async (response) => {
        if (response.status === 404) {
          setMissing(true);
          return;
        }
        if (!response.ok) throw new Error('product_detail_failed');
        const next = productDetailResponseSchema.parse(await response.json());
        if (controller.signal.aborted) return;
        setDetail(next);
        const firstSelectable = next.variants.find((variant) => variant.selectable);
        setSelectedColor(firstSelectable?.color ?? next.variants[0]?.color ?? '');
        setSelectedVariantId(firstSelectable?.id);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError('Ürün detayı şu anda yüklenemiyor. Yeniden deneyebilirsin.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [productId, searchParams]);

  const colors = useMemo(
    () => [...new Set(detail?.variants.map((variant) => variant.color) ?? [])],
    [detail],
  );
  const visibleVariants = useMemo(
    () =>
      detail?.variants.filter(
        (variant) => !selectedColor || variant.color === selectedColor,
      ) ?? [],
    [detail, selectedColor],
  );
  const selectedVariant = detail?.variants.find(
    (variant) => variant.id === selectedVariantId,
  );
  const selectedOffers = detail?.offers.filter(
    (offer) => offer.variantId === selectedVariantId,
  );
  const checkoutOffer = selectedOffers
    ?.filter((offer) => offer.checkoutAvailable && offer.checkoutUrl)
    .sort((left, right) => left.priceMinor - right.priceMinor)[0];
  const displayOffer =
    checkoutOffer ??
    selectedOffers?.slice().sort((left, right) => left.priceMinor - right.priceMinor)[0] ??
    detail?.offers.slice().sort((left, right) => left.priceMinor - right.priceMinor)[0];

  function chooseColor(color: string) {
    setSelectedColor(color);
    const next = detail?.variants.find(
      (variant) => variant.color === color && variant.selectable,
    );
    setSelectedVariantId(next?.id);
  }

  if (loading)
    return (
      <main className="store-shell">
        <p role="status">Ürün yükleniyor…</p>
      </main>
    );
  if (missing)
    return (
      <main className="store-shell store-message">
        <a className="brand" href="/">ShopAI<span>●</span></a>
        <h1>Bu ürünü bulamadık.</h1>
        <p>Ürün yayından kalkmış veya mağaza artık herkese açık olmayabilir.</p>
      </main>
    );
  if (!detail)
    return (
      <main className="store-shell store-message">
        <h1>Ürün yüklenemedi.</h1>
        <p role="alert">{error}</p>
      </main>
    );

  return (
    <main className="store-shell">
      <header className="store-header">
        <a className="brand" href="/">ShopAI<span>●</span></a>
        <a href={`/shop/${detail.merchant.slug}`}>{detail.merchant.displayName}</a>
      </header>

      <section
        aria-labelledby="product-title"
        style={{
          display: 'grid',
          gap: 32,
          gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))',
          padding: '32px 0',
        }}
      >
        <div>
          {detail.images[0] ? (
            <img
              src={detail.images[0].url}
              alt={detail.images[0].alt ?? detail.product.title}
              style={{ width: '100%', borderRadius: 24, objectFit: 'cover' }}
            />
          ) : (
            <div
              role="img"
              aria-label={`${detail.product.title} görseli yok`}
              className="product-image-placeholder"
              style={{ minHeight: 360, borderRadius: 24 }}
            >
              ♧
            </div>
          )}
        </div>

        <div style={{ display: 'grid', alignContent: 'start', gap: 20 }}>
          <div>
            <p className="eyebrow">{detail.merchant.displayName}</p>
            <h1 id="product-title">{detail.product.title}</h1>
            {detail.brand ? <p>{detail.brand}</p> : null}
            {displayOffer ? (
              <strong className="product-price" style={{ fontSize: 28 }}>
                {money(displayOffer.priceMinor, displayOffer.currency)}
              </strong>
            ) : null}
          </div>

          {colors.length ? (
            <fieldset>
              <legend>Renk</legend>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {colors.map((color) => {
                  const selectable = detail.variants.some(
                    (variant) => variant.color === color && variant.selectable,
                  );
                  return (
                    <button
                      key={color}
                      type="button"
                      disabled={!selectable}
                      aria-pressed={selectedColor === color}
                      onClick={() => chooseColor(color)}
                    >
                      {colorLabels[color] ?? color}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ) : null}

          <fieldset>
            <legend>Beden</legend>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {visibleVariants.map((variant) => (
                <button
                  key={variant.id}
                  type="button"
                  disabled={!variant.selectable}
                  aria-pressed={selectedVariantId === variant.id}
                  aria-label={`${variant.size} beden, ${stockStatusLabel(variant.availability)}`}
                  onClick={() => setSelectedVariantId(variant.id)}
                >
                  {variant.size}
                </button>
              ))}
            </div>
          </fieldset>

          <p className={`stock stock-${selectedVariant?.availability ?? detail.availability}`}>
            {selectedVariant
              ? `${selectedVariant.size} ${stockStatusLabel(selectedVariant.availability)}`
              : stockStatusLabel(detail.availability)}
            {selectedVariant?.selectable ? ' ✓' : ''}
          </p>

          {checkoutOffer?.checkoutUrl ? (
            <a
              className="search-button"
              href={checkoutOffer.checkoutUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ textAlign: 'center', textDecoration: 'none' }}
            >
              Satın Al
            </a>
          ) : (
            <button className="search-button" type="button" disabled>
              Bu varyant satın alınamıyor
            </button>
          )}

          {detail.description ? <p>{detail.description}</p> : null}
          {Object.keys(detail.attributes).length ? (
            <dl>
              {Object.entries(detail.attributes).map(([key, values]) => (
                <div key={key} style={{ display: 'flex', gap: 8 }}>
                  <dt><strong>{key}</strong></dt>
                  <dd>{values.join(', ')}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
      </section>

      {detail.similarProducts.length ? (
        <section className="store-results" aria-labelledby="similar-title">
          <div>
            <p className="eyebrow">Keşfetmeye devam et</p>
            <h2 id="similar-title">Benzer ürünler</h2>
          </div>
          <ul className="product-grid">
            {detail.similarProducts.map((item) => (
              <ProductCard key={item.offerId} item={item} />
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
