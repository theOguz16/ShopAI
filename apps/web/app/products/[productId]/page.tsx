'use client';

import { stockStatusLabel } from '@shopai/contracts';
import { productAlertResponseSchema } from '@shopai/contracts/product-alerts';
import {
  type ProductDetailResponse,
  productDetailResponseSchema,
} from '@shopai/contracts/product-detail';
import {
  savedProductResponseSchema,
  savedProductsResponseSchema,
  unsaveProductResponseSchema,
} from '@shopai/contracts/saved-products';
import { ProductCard } from '@shopai/ui';
import { useParams, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { buildProductDetailHref } from '../../../lib/product-detail-href';

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

function savedKey(productId: string, variantId?: string | null) {
  return `${productId}:${variantId ?? '-'}`;
}

export default function ProductDetailPage() {
  const { productId } = useParams<{ productId: string }>();
  const searchParams = useSearchParams();
  const [detail, setDetail] = useState<ProductDetailResponse>();
  const [selectedColor, setSelectedColor] = useState('');
  const [selectedVariantId, setSelectedVariantId] = useState<string>();
  const [savedIds, setSavedIds] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [savedStateLoading, setSavedStateLoading] = useState(true);
  const [alerting, setAlerting] = useState<
    'PRICE_BELOW' | 'BACK_IN_STOCK' | null
  >(null);
  const [alertNotice, setAlertNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams();
    const searchId = searchParams.get('searchId');
    const discoverySessionId = searchParams.get('discoverySessionId');
    if (searchId) query.set('searchId', searchId);
    if (discoverySessionId) query.set('discoverySessionId', discoverySessionId);
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
        const firstSelectable = next.variants.find(
          (variant) => variant.selectable,
        );
        const firstVariant = firstSelectable ?? next.variants[0];
        setSelectedColor(firstVariant?.color ?? '');
        setSelectedVariantId(firstVariant?.id);
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

  useEffect(() => {
    const controller = new AbortController();
    setSavedStateLoading(true);
    setSavedIds({});
    void fetch(`${api}/v1/saved-products`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('saved_products_failed');
        const result = savedProductsResponseSchema.parse(await response.json());
        if (controller.signal.aborted) return;
        setSavedIds(
          Object.fromEntries(
            result.items.map((item) => [
              savedKey(item.productId, item.variantId),
              item.id,
            ]),
          ),
        );
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError(
            'Kayıt durumu şu anda yüklenemiyor. Yeniden deneyebilirsin.',
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setSavedStateLoading(false);
      });
    return () => controller.abort();
  }, []);

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
    selectedOffers
      ?.slice()
      .sort((left, right) => left.priceMinor - right.priceMinor)[0] ??
    detail?.offers
      .slice()
      .sort((left, right) => left.priceMinor - right.priceMinor)[0];
  const currentSavedKey = savedKey(productId, selectedVariantId);
  const currentSavedId = savedIds[currentSavedKey];
  const isSaved = Boolean(currentSavedId);

  function chooseColor(color: string) {
    setSelectedColor(color);
    const matching = detail?.variants.filter(
      (variant) => variant.color === color,
    );
    const next =
      matching?.find((variant) => variant.selectable) ?? matching?.[0];
    setSelectedVariantId(next?.id);
  }

  function clearSavedId(key: string) {
    setSavedIds((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  async function toggleSavedProduct() {
    if (!detail || saving || savedStateLoading) return;
    setSaving(true);
    setError('');
    try {
      if (currentSavedId) {
        const response = await fetch(
          `${api}/v1/saved-products/${encodeURIComponent(currentSavedId)}`,
          {
            method: 'DELETE',
            credentials: 'include',
          },
        );
        if (response.status === 404) {
          clearSavedId(currentSavedKey);
          return;
        }
        if (!response.ok) throw new Error('unsave_product_failed');
        const result = unsaveProductResponseSchema.parse(await response.json());
        if (result.removed) clearSavedId(currentSavedKey);
        return;
      }

      const response = await fetch(`${api}/v1/saved-products`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: detail.product.id,
          ...(selectedVariantId ? { variantId: selectedVariantId } : {}),
        }),
      });
      if (!response.ok) throw new Error('save_product_failed');
      const result = savedProductResponseSchema.parse(await response.json());
      setSavedIds((current) => ({
        ...current,
        [currentSavedKey]: result.item.id,
      }));
    } catch {
      setError(
        isSaved
          ? 'Ürün kayıttan çıkarılamadı. Yeniden deneyebilirsin.'
          : 'Ürün kaydedilemedi. Yeniden deneyebilirsin.',
      );
    } finally {
      setSaving(false);
    }
  }

  function askEmail() {
    return window.prompt('Bildirim e-posta adresin:')?.trim() ?? '';
  }

  async function createPriceAlert() {
    if (!detail || !displayOffer || alerting) return;
    const defaultTarget = Math.max(
      1,
      Math.floor((displayOffer.priceMinor / 100) * 0.9),
    ).toString();
    const target = window.prompt(
      'Hangi fiyatın altına düşünce haber verelim? (TL)',
      defaultTarget,
    );
    if (target === null) return;
    const targetLira = Number(target.replace(',', '.'));
    if (!Number.isFinite(targetLira) || targetLira <= 0) {
      setError('Geçerli bir hedef fiyat gir.');
      return;
    }
    const email = askEmail();
    if (!email) return;
    setAlerting('PRICE_BELOW');
    setError('');
    setAlertNotice('');
    try {
      const response = await fetch(`${api}/v1/product-alerts`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: detail.product.id,
          ...(selectedVariantId ? { variantId: selectedVariantId } : {}),
          conditionType: 'PRICE_BELOW',
          targetValue: Math.round(targetLira * 100),
          email,
        }),
      });
      if (!response.ok) throw new Error('price_alert_failed');
      const result = productAlertResponseSchema.parse(await response.json());
      setAlertNotice(
        `🔔 ${money(result.alert.targetValue ?? 0, 'TRY')} altına düşünce ${result.alert.email} adresine haber vereceğiz.`,
      );
    } catch {
      setError('Fiyat alarmı oluşturulamadı. Yeniden deneyebilirsin.');
    } finally {
      setAlerting(null);
    }
  }

  async function createStockAlert() {
    if (!detail || !selectedVariant || alerting) return;
    const email = askEmail();
    if (!email) return;
    setAlerting('BACK_IN_STOCK');
    setError('');
    setAlertNotice('');
    try {
      const response = await fetch(`${api}/v1/product-alerts`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: detail.product.id,
          variantId: selectedVariant.id,
          conditionType: 'BACK_IN_STOCK',
          email,
        }),
      });
      if (!response.ok) throw new Error('stock_alert_failed');
      const result = productAlertResponseSchema.parse(await response.json());
      setAlertNotice(
        `🔔 ${selectedVariant.size} beden gelince ${result.alert.email} adresine haber vereceğiz.`,
      );
    } catch {
      setError('Stok alarmı oluşturulamadı. Yeniden deneyebilirsin.');
    } finally {
      setAlerting(null);
    }
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
        <a className="brand" href="/">
          ShopAI<span>●</span>
        </a>
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
        <a className="brand" href="/">
          ShopAI<span>●</span>
        </a>
        <nav style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <a href="/saved">♡ Kaydedilenler</a>
          <a href={`/shop/${detail.merchant.slug}`}>
            {detail.merchant.displayName}
          </a>
        </nav>
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
                {colors.map((color) => (
                  <button
                    key={color}
                    type="button"
                    aria-pressed={selectedColor === color}
                    onClick={() => chooseColor(color)}
                  >
                    {colorLabels[color] ?? color}
                  </button>
                ))}
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
                  aria-pressed={selectedVariantId === variant.id}
                  aria-label={`${variant.size} beden, ${stockStatusLabel(variant.availability)}`}
                  onClick={() => setSelectedVariantId(variant.id)}
                >
                  {variant.size}
                </button>
              ))}
            </div>
          </fieldset>

          <p
            className={`stock stock-${selectedVariant?.availability ?? detail.availability}`}
          >
            {selectedVariant
              ? `${selectedVariant.size} ${stockStatusLabel(selectedVariant.availability)}`
              : stockStatusLabel(detail.availability)}
            {selectedVariant?.selectable ? ' ✓' : ''}
          </p>

          <button
            type="button"
            aria-pressed={isSaved}
            disabled={saving || savedStateLoading}
            onClick={() => void toggleSavedProduct()}
            style={{
              minHeight: 44,
              borderRadius: 12,
              border: '1px solid #d7ddd8',
              background: isSaved ? '#f5e8ec' : '#fff',
              fontWeight: 700,
            }}
          >
            {savedStateLoading
              ? 'Kayıt durumu yükleniyor…'
              : saving
                ? isSaved
                  ? 'Kayıttan çıkarılıyor…'
                  : 'Kaydediliyor…'
                : isSaved
                  ? '♥ Kaydedildi'
                  : '♡ Kaydet'}
          </button>

          <button
            type="button"
            disabled={!displayOffer || alerting !== null}
            onClick={() => void createPriceAlert()}
          >
            {alerting === 'PRICE_BELOW'
              ? 'Fiyat alarmı oluşturuluyor…'
              : '🔔 Fiyat düşünce haber ver'}
          </button>

          {selectedVariant && selectedVariant.availability !== 'in_stock' ? (
            <button
              type="button"
              disabled={alerting !== null}
              onClick={() => void createStockAlert()}
            >
              {alerting === 'BACK_IN_STOCK'
                ? 'Stok alarmı oluşturuluyor…'
                : `🔔 ${selectedVariant.size} beden gelince haber ver`}
            </button>
          ) : null}

          {alertNotice ? <p role="status">{alertNotice}</p> : null}

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

          {error ? <p role="alert">{error}</p> : null}
          {detail.description ? <p>{detail.description}</p> : null}
          {Object.keys(detail.attributes).length ? (
            <dl>
              {Object.entries(detail.attributes).map(([key, values]) => (
                <div key={key} style={{ display: 'flex', gap: 8 }}>
                  <dt>
                    <strong>{key}</strong>
                  </dt>
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
              <ProductCard
                key={item.offerId}
                item={item}
                detailHref={buildProductDetailHref({
                  productId: item.productId,
                  searchId: detail.searchId,
                  discoverySessionId: searchParams.get('discoverySessionId'),
                })}
              />
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
