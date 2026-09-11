import { stockStatusLabel } from '@shopai/contracts';
import {
  type ProductDetailResponse,
  productDetailResponseSchema,
} from '@shopai/contracts/product-detail';
import {
  type SearchProductsResponse,
  searchProductsResponseSchema,
} from '@shopai/contracts/search-products';
import { ProductCard } from '@shopai/ui';
import {
  type ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { createRoot } from 'react-dom/client';
import { createHostBridge, type WidgetSearchInput } from './host-bridge.js';

const DTO_VERSION = 1;

function selectedSize(input: WidgetSearchInput) {
  const value = input.attributes?.size ?? input.attributes?.sizes;
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

function Widget() {
  const bridge = useMemo(() => createHostBridge(), []);
  const [input, setInput] = useState<WidgetSearchInput>(
    bridge.snapshot().input ?? {},
  );
  const [result, setResult] = useState<SearchProductsResponse>();
  const [detail, setDetail] = useState<ProductDetailResponse>();
  const [selectedColor, setSelectedColor] = useState('');
  const [selectedVariantId, setSelectedVariantId] = useState<string>();
  const [loading, setLoading] = useState(bridge.available);
  const [error, setError] = useState('');

  const showDetail = useCallback((next: ProductDetailResponse) => {
    setDetail(next);
    const firstSelectable = next.variants.find((variant) => variant.selectable);
    setSelectedColor(firstSelectable?.color ?? next.variants[0]?.color ?? '');
    setSelectedVariantId(firstSelectable?.id);
  }, []);

  useEffect(() => {
    const unsubscribe = bridge.subscribe((snapshot) => {
      if (snapshot.input) setInput(snapshot.input);
      if (!snapshot.output) return;
      const search = searchProductsResponseSchema.safeParse(snapshot.output);
      if (search.success) {
        setResult(search.data);
        setDetail(undefined);
        setError('');
        setLoading(false);
        return;
      }
      const productDetail = productDetailResponseSchema.safeParse(
        snapshot.output,
      );
      if (productDetail.success) {
        showDetail(productDetail.data);
        setError('');
      } else {
        setError(
          'Ürün verisi bu widget sürümüyle uyumlu değil. Aramayı sohbetten yeniden çalıştırın.',
        );
      }
      setLoading(false);
    });
    return () => {
      unsubscribe();
      bridge.destroy();
    };
  }, [bridge, showDetail]);

  async function changeSize(event: ChangeEvent<HTMLSelectElement>) {
    const size = event.target.value;
    const attributes = { ...(input.attributes ?? {}) };
    delete attributes.size;
    delete attributes.sizes;
    if (size) attributes.size = [size];
    const { cursor: _cursor, ...withoutCursor } = input;
    const nextInput: WidgetSearchInput = {
      ...withoutCursor,
      ...(Object.keys(attributes).length ? { attributes } : {}),
    };
    setInput(nextInput);
    setDetail(undefined);
    setLoading(true);
    setError('');
    try {
      setResult(await bridge.callSearch(nextInput));
    } catch {
      setError(
        'Filtre uygulanamadı. Bağlantıyı kontrol edip sohbetten aramayı yeniden deneyin.',
      );
    } finally {
      setLoading(false);
    }
  }

  async function localPreview() {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('http://127.0.0.1:4000/v1/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!response.ok) throw new Error('API erişilemiyor');
      setResult(searchProductsResponseSchema.parse(await response.json()));
    } catch {
      setError('Yerel API erişilemiyor.');
    } finally {
      setLoading(false);
    }
  }

  async function openDetail(productId: string) {
    setLoading(true);
    setError('');
    const request = {
      productId,
      ...(result?.searchId ? { searchId: result.searchId } : {}),
      ...(input.discoverySessionId
        ? { discoverySessionId: input.discoverySessionId }
        : {}),
    };
    try {
      if (bridge.available) {
        showDetail(await bridge.callProductDetail(request));
      } else {
        const query = new URLSearchParams();
        if (request.searchId) query.set('searchId', request.searchId);
        if (request.discoverySessionId)
          query.set('discoverySessionId', request.discoverySessionId);
        const response = await fetch(
          `http://127.0.0.1:4000/v1/products/${productId}/detail?${query.toString()}`,
        );
        if (!response.ok) throw new Error('detail_failed');
        showDetail(productDetailResponseSchema.parse(await response.json()));
      }
    } catch {
      setError('Ürün detayı yüklenemedi. Aramaya dönüp yeniden deneyin.');
    } finally {
      setLoading(false);
    }
  }

  const localHost = ['127.0.0.1', 'localhost'].includes(
    window.location.hostname,
  );
  const size = selectedSize(input);
  const detailColors = [
    ...new Set(detail?.variants.map((variant) => variant.color) ?? []),
  ];
  const visibleVariants =
    detail?.variants.filter(
      (variant) => !selectedColor || variant.color === selectedColor,
    ) ?? [];
  const selectedVariant = detail?.variants.find(
    (variant) => variant.id === selectedVariantId,
  );
  const selectedOffer = detail?.offers
    .filter(
      (offer) =>
        offer.variantId === selectedVariantId &&
        offer.checkoutAvailable &&
        offer.checkoutUrl,
    )
    .sort((left, right) => left.priceMinor - right.priceMinor)[0];
  const displayOffer =
    selectedOffer ??
    detail?.offers
      .filter((offer) => offer.variantId === selectedVariantId)
      .sort((left, right) => left.priceMinor - right.priceMinor)[0] ??
    detail?.offers
      .slice()
      .sort((left, right) => left.priceMinor - right.priceMinor)[0];

  function chooseColor(color: string) {
    setSelectedColor(color);
    const next = detail?.variants.find(
      (variant) => variant.color === color && variant.selectable,
    );
    setSelectedVariantId(next?.id);
  }

  return (
    <main
      style={{
        color: '#172019',
        fontFamily: 'system-ui, sans-serif',
        padding: 16,
      }}
    >
      <header
        style={{
          alignItems: 'end',
          display: 'flex',
          flexWrap: 'wrap',
          gap: 12,
          justifyContent: 'space-between',
          marginBottom: 16,
        }}
      >
        <div>
          <strong>ShopAI</strong>
          <div style={{ color: '#536259', fontSize: 13 }}>
            Yalnız yayımlanmış katalog sonuçları
          </div>
        </div>
        {!detail ? (
          <label style={{ display: 'grid', fontSize: 13, gap: 4 }}>
            Beden
            <select
              aria-label="Beden filtresi"
              disabled={loading || !bridge.available}
              onChange={(event) => void changeSize(event)}
              value={size}
            >
              <option value="">Tümü</option>
              {['XS', 'S', 'M', 'L', 'XL', 'XXL'].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <button type="button" onClick={() => setDetail(undefined)}>
            ← Sonuçlara dön
          </button>
        )}
      </header>

      {!bridge.available && !result ? (
        <section role="status">
          <p>
            Uyumlu bir MCP Apps host’u bulunamadı. Widget araç çağrısı yapamaz.
          </p>
          {localHost ? (
            <button type="button" onClick={() => void localPreview()}>
              Yerel önizlemeyi yükle
            </button>
          ) : null}
        </section>
      ) : null}
      {loading ? <p role="status">Ürünler yükleniyor…</p> : null}
      {error ? <p role="alert">{error}</p> : null}

      {detail ? (
        <section aria-label="Ürün detayı" style={{ display: 'grid', gap: 16 }}>
          {detail.images[0] ? (
            <img
              src={detail.images[0].url}
              alt={detail.images[0].alt ?? detail.product.title}
              style={{
                borderRadius: 16,
                maxHeight: 280,
                objectFit: 'cover',
                width: '100%',
              }}
            />
          ) : null}
          <div>
            <small>{detail.merchant.displayName}</small>
            <h2 style={{ margin: '4px 0' }}>{detail.product.title}</h2>
            {displayOffer ? (
              <strong style={{ fontSize: 22 }}>
                {new Intl.NumberFormat('tr-TR', {
                  style: 'currency',
                  currency: displayOffer.currency,
                }).format(displayOffer.priceMinor / 100)}
              </strong>
            ) : null}
          </div>
          <fieldset>
            <legend>Renk</legend>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {detailColors.map((color) => {
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
                    {color}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <fieldset>
            <legend>Beden</legend>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {visibleVariants.map((variant) => (
                <button
                  key={variant.id}
                  type="button"
                  disabled={!variant.selectable}
                  aria-pressed={selectedVariantId === variant.id}
                  onClick={() => setSelectedVariantId(variant.id)}
                >
                  {variant.size}
                </button>
              ))}
            </div>
          </fieldset>
          <p>
            {selectedVariant
              ? `${selectedVariant.size} ${stockStatusLabel(selectedVariant.availability)}${selectedVariant.selectable ? ' ✓' : ''}`
              : stockStatusLabel(detail.availability)}
          </p>
          {selectedOffer?.checkoutUrl ? (
            <a
              href={selectedOffer.checkoutUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontWeight: 700 }}
            >
              Satın Al ↗
            </a>
          ) : (
            <button type="button" disabled>
              Bu varyant satın alınamıyor
            </button>
          )}
          {detail.description ? <p>{detail.description}</p> : null}
          {detail.similarProducts.length ? (
            <section aria-label="Benzer ürünler">
              <h3>Benzer ürünler</h3>
              <div style={{ display: 'grid', gap: 12 }}>
                {detail.similarProducts.map((item) => (
                  <ProductCard
                    key={item.offerId}
                    item={item}
                    demo={localHost}
                    onDetail={(next) => void openDetail(next.productId)}
                  />
                ))}
              </div>
            </section>
          ) : null}
        </section>
      ) : (
        <>
          {!loading && result && !result.products.length ? (
            <p role="status">
              Bu koşullara uygun ürün bulunamadı; filtreler gevşetilmedi.
            </p>
          ) : null}
          <section
            aria-label="Ürün sonuçları"
            style={{
              display: 'grid',
              gap: 12,
              gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))',
            }}
          >
            {result?.products.map((item) => (
              <ProductCard
                key={item.offerId}
                item={item}
                demo={localHost}
                onDetail={(next) => void openDetail(next.productId)}
              />
            ))}
          </section>
        </>
      )}
    </main>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Root element missing');
if (root.dataset.dtoVersion && Number(root.dataset.dtoVersion) !== DTO_VERSION)
  throw new Error('Widget shell DTO version mismatch');
createRoot(root).render(<Widget />);
