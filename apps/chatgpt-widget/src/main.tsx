import { type CatalogItem, stockStatusLabel } from '@shopai/contracts';
import {
  type ProductDetailResponse,
  productDetailResponseSchema,
} from '@shopai/contracts/product-detail';
import {
  type SearchProductsResponse,
  searchProductsResponseSchema,
} from '@shopai/contracts/search-products';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createHostBridge, type WidgetSearchInput } from './host-bridge.js';
import {
  clearPriceFilter,
  queryContextChips,
  removeQueryContext,
  resolveWidgetView,
  selectCategory,
  selectedAttributeValues,
  toggleAttributeFilter,
  type WidgetView,
  WIDGET_VIEWS,
} from './shopping-state.js';
import './styles.css';

const DTO_VERSION = 1;
const colorLabels: Record<string, string> = {
  black: 'Siyah',
  white: 'Beyaz',
  navy: 'Lacivert',
  gray: 'Gri',
  grey: 'Gri',
  blue: 'Mavi',
  red: 'Kırmızı',
  green: 'Yeşil',
};

function formatMoney(amountMinor: number, currency = 'TRY') {
  return new Intl.NumberFormat('tr-TR', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amountMinor / 100);
}

function formatPriceFilter(input: WidgetSearchInput) {
  if (!input.price) return undefined;
  const minimum = input.price.min;
  const maximum = input.price.max;
  if (minimum !== undefined && maximum !== undefined)
    return `${formatMoney(minimum)}–${formatMoney(maximum)}`;
  if (minimum !== undefined) return `${formatMoney(minimum)}+`;
  if (maximum !== undefined) return `≤ ${formatMoney(maximum)}`;
  return undefined;
}

function categoryLabel(value: string) {
  if (value === 'tshirt') return 'T-Shirt';
  if (value === 'fishing-rod') return 'Fishing Rod';
  return value
    .replace(/[-_]+/gu, ' ')
    .replace(/\b\p{L}/gu, (letter) => letter.toLocaleUpperCase('tr-TR'));
}

function mergeValues(available: string[], selected: string[]) {
  return [...new Set([...selected, ...available])];
}

function ProductImage({ item }: { item: CatalogItem }) {
  const [failed, setFailed] = useState(false);
  if (!item.imageUrl || failed)
    return (
      <div
        className="shopping-card-placeholder"
        role="img"
        aria-label={`${item.title} görseli yok`}
      >
        Ürün görseli yok
      </div>
    );
  return (
    <img
      className="shopping-card-image"
      src={item.imageUrl}
      alt={item.imageAlt ?? item.title}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

function ShoppingProductCard({
  item,
  disabled,
  onInspect,
}: {
  item: CatalogItem;
  disabled?: boolean;
  onInspect(item: CatalogItem): void;
}) {
  const stock = stockStatusLabel(item.stockStatus);
  return (
    <article className="shopping-card">
      <div className="shopping-card-image-wrap">
        <ProductImage item={item} />
      </div>
      <div className="shopping-card-body">
        <p className="shopping-card-merchant">{item.merchantName}</p>
        <h3 className="shopping-card-title">{item.title}</h3>
        <strong className="shopping-card-price">
          {formatMoney(item.priceMinor, item.currency)}
        </strong>
        <p className="shopping-card-stock">
          {item.size ? `${item.size} · ` : ''}
          {stock}
          {item.stockStatus === 'in_stock' ? ' ✓' : ''}
        </p>
        <button
          className="shopping-card-action"
          type="button"
          disabled={disabled}
          onClick={() => onInspect(item)}
        >
          İncele
        </button>
      </div>
    </article>
  );
}

function Widget() {
  const bridge = useMemo(() => createHostBridge(), []);
  const initialInput = bridge.snapshot().input ?? {};
  const [input, setInput] = useState<WidgetSearchInput>(initialInput);
  const [result, setResult] = useState<SearchProductsResponse>();
  const [detail, setDetail] = useState<ProductDetailResponse>();
  const [view, setView] = useState<WidgetView>(WIDGET_VIEWS.PRODUCT_GRID);
  const [selectedColor, setSelectedColor] = useState('');
  const [selectedVariantId, setSelectedVariantId] = useState<string>();
  const [loading, setLoading] = useState(bridge.available);
  const [error, setError] = useState('');
  const localHost = ['127.0.0.1', 'localhost'].includes(
    window.location.hostname,
  );

  const applySearchResult = useCallback(
    (nextInput: WidgetSearchInput, nextResult: SearchProductsResponse) => {
      setInput(nextInput);
      setResult(nextResult);
      setDetail(undefined);
      setView(
        resolveWidgetView({
          request: nextInput,
          result: nextResult,
          hasDetail: false,
        }),
      );
      setError('');
    },
    [],
  );

  const showDetail = useCallback((next: ProductDetailResponse) => {
    setDetail(next);
    const firstSelectable = next.variants.find((variant) => variant.selectable);
    setSelectedColor(firstSelectable?.color ?? next.variants[0]?.color ?? '');
    setSelectedVariantId(firstSelectable?.id);
    setView(WIDGET_VIEWS.PRODUCT_DETAIL);
  }, []);

  useEffect(() => {
    const unsubscribe = bridge.subscribe((snapshot) => {
      if (snapshot.input) setInput(snapshot.input);
      if (!snapshot.output) return;
      const search = searchProductsResponseSchema.safeParse(snapshot.output);
      if (search.success) {
        applySearchResult(
          snapshot.input ?? bridge.snapshot().input ?? {},
          search.data,
        );
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
  }, [applySearchResult, bridge, showDetail]);

  async function executeSearch(nextInput: WidgetSearchInput) {
    if (bridge.available) return bridge.callSearch(nextInput);
    if (!localHost) throw new Error('host_unavailable');
    const response = await fetch('http://127.0.0.1:4000/v1/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(nextInput),
    });
    if (!response.ok) throw new Error('search_failed');
    return searchProductsResponseSchema.parse(await response.json());
  }

  async function runSearch(nextInput: WidgetSearchInput) {
    setInput(nextInput);
    setDetail(undefined);
    setLoading(true);
    setError('');
    try {
      const nextResult = await executeSearch(nextInput);
      applySearchResult(nextInput, nextResult);
    } catch {
      setError(
        'Filtre uygulanamadı. Bağlantıyı kontrol edip sohbetten aramayı yeniden deneyin.',
      );
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

  const selectedColors = selectedAttributeValues(input, 'color');
  const selectedSizes = selectedAttributeValues(input, 'size');
  const colors = mergeValues(
    result?.facets.colors.map((facet) => facet.value) ?? [],
    selectedColors,
  );
  const sizes = mergeValues(
    result?.facets.sizes.map((facet) => facet.value) ?? [],
    selectedSizes,
  );
  const contextChips = queryContextChips(input.query);
  const priceChip = formatPriceFilter(input);
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

  function returnToGrid() {
    setDetail(undefined);
    setView(WIDGET_VIEWS.PRODUCT_GRID);
  }

  const canInteract = bridge.available || localHost;

  return (
    <main className="shop-shell" data-widget-state={view}>
      <header className="shop-header">
        <div className="shop-brand">
          <strong>ShopAI</strong>
          <p className="shop-subtitle">
            Yayımlanmış kataloglardan görsel alışveriş
          </p>
        </div>
        {view === WIDGET_VIEWS.PRODUCT_DETAIL ? (
          <button className="back-button" type="button" onClick={returnToGrid}>
            ← Sonuçlara dön
          </button>
        ) : null}
      </header>

      {!bridge.available && !result ? (
        <section className="status-card" role="status">
          <p className="shop-muted">
            Uyumlu bir MCP Apps host’u bulunamadı. Widget araç çağrısı yapamaz.
          </p>
          {localHost ? (
            <button
              className="secondary-button"
              type="button"
              onClick={() => void runSearch(input)}
            >
              Yerel önizlemeyi yükle
            </button>
          ) : null}
        </section>
      ) : null}

      {loading ? (
        <div className="status-card loading-line" role="status">
          <span className="loading-dot" aria-hidden="true" />
          Ürünler güncelleniyor…
        </div>
      ) : null}
      {error ? (
        <div className="status-card error-card" role="alert">
          {error}
        </div>
      ) : null}

      {view === WIDGET_VIEWS.CATEGORY_SELECT && result ? (
        <section className="category-panel" aria-label="Kategori seçimi">
          <div>
            <h2>Ne arıyorsun?</h2>
            <p className="shop-muted">
              Sonuçları daraltmak için bir kategori seçebilirsin.
            </p>
          </div>
          <div className="category-grid">
            {result.facets.categories.map((category) => (
              <button
                className="category-card"
                key={category.value}
                type="button"
                disabled={loading || !canInteract}
                onClick={() =>
                  void runSearch(selectCategory(input, category.value))
                }
              >
                <span className="category-name">
                  {categoryLabel(category.value)}
                </span>
                <span className="category-count">{category.count} ürün</span>
              </button>
            ))}
          </div>
          <button
            className="secondary-button"
            type="button"
            onClick={() => setView(WIDGET_VIEWS.PRODUCT_GRID)}
          >
            Tüm sonuçları gör
          </button>
        </section>
      ) : null}

      {view === WIDGET_VIEWS.PRODUCT_GRID && result ? (
        <>
          <section className="facets" aria-label="Hızlı filtreler">
            {input.category ? (
              <div className="facet-row">
                <span className="facet-label">Kategori</span>
                <button
                  className="facet-chip facet-chip-active"
                  type="button"
                  disabled={loading || !canInteract}
                  aria-pressed="true"
                  onClick={() => void runSearch(selectCategory(input))}
                >
                  {categoryLabel(input.category)} ×
                </button>
              </div>
            ) : null}

            {colors.length ? (
              <div className="facet-row">
                <span className="facet-label">Renk</span>
                {colors.slice(0, 10).map((color) => {
                  const active = selectedColors.includes(color);
                  return (
                    <button
                      className={`facet-chip${active ? ' facet-chip-active' : ''}`}
                      key={color}
                      type="button"
                      disabled={loading || !canInteract}
                      aria-pressed={active}
                      onClick={() =>
                        void runSearch(
                          toggleAttributeFilter(input, 'color', color),
                        )
                      }
                    >
                      {colorLabels[color] ?? color}
                      {active ? ' ×' : ''}
                    </button>
                  );
                })}
              </div>
            ) : null}

            {sizes.length ? (
              <div className="facet-row">
                <span className="facet-label">Beden</span>
                {sizes.slice(0, 10).map((size) => {
                  const active = selectedSizes.includes(size);
                  return (
                    <button
                      className={`facet-chip${active ? ' facet-chip-active' : ''}`}
                      key={size}
                      type="button"
                      disabled={loading || !canInteract}
                      aria-pressed={active}
                      onClick={() =>
                        void runSearch(
                          toggleAttributeFilter(input, 'size', size),
                        )
                      }
                    >
                      {size}
                      {active ? ' ×' : ''}
                    </button>
                  );
                })}
              </div>
            ) : null}

            {contextChips.length || priceChip ? (
              <div className="facet-row">
                <span className="facet-label">Aktif</span>
                {contextChips.map((chip) => (
                  <button
                    className="facet-chip facet-chip-active facet-chip-context"
                    key={chip.id}
                    type="button"
                    disabled={loading || !canInteract}
                    aria-pressed="true"
                    title="Arama metninden gelen bağlamsal filtre"
                    onClick={() =>
                      void runSearch(removeQueryContext(input, chip.id))
                    }
                  >
                    {chip.label} ×
                  </button>
                ))}
                {priceChip ? (
                  <button
                    className="facet-chip facet-chip-active"
                    type="button"
                    disabled={loading || !canInteract}
                    aria-pressed="true"
                    onClick={() => void runSearch(clearPriceFilter(input))}
                  >
                    {priceChip} ×
                  </button>
                ) : null}
              </div>
            ) : null}
          </section>

          <div className="result-meta">
            <span>{result.products.length} ürün gösteriliyor</span>
            {input.query ? <span>“{input.query}”</span> : null}
          </div>

          {!loading && !result.products.length ? (
            <div className="empty-card" role="status">
              Bu koşullara uygun ürün bulunamadı; filtreler otomatik olarak
              gevşetilmedi.
            </div>
          ) : null}

          <section className="product-grid" aria-label="Ürün sonuçları">
            {result.products.map((item) => (
              <ShoppingProductCard
                key={item.offerId}
                item={item}
                disabled={loading}
                onInspect={(next) => void openDetail(next.productId)}
              />
            ))}
          </section>
        </>
      ) : null}

      {view === WIDGET_VIEWS.PRODUCT_DETAIL && detail ? (
        <section className="detail-shell" aria-label="Ürün detayı">
          <div className="detail-hero">
            <div className="detail-media">
              {detail.images[0] ? (
                <img
                  className="detail-image"
                  src={detail.images[0].url}
                  alt={detail.images[0].alt ?? detail.product.title}
                />
              ) : (
                <div className="shopping-card-placeholder" role="img">
                  Ürün görseli yok
                </div>
              )}
            </div>
            <div className="detail-copy">
              <span className="detail-merchant">
                {detail.merchant.displayName}
              </span>
              <h2 className="detail-title">{detail.product.title}</h2>
              {displayOffer ? (
                <strong className="detail-price">
                  {formatMoney(displayOffer.priceMinor, displayOffer.currency)}
                </strong>
              ) : null}

              <fieldset className="option-group">
                <legend>Renk</legend>
                <div className="option-row">
                  {detailColors.map((color) => {
                    const selectable = detail.variants.some(
                      (variant) =>
                        variant.color === color && variant.selectable,
                    );
                    return (
                      <button
                        className="option-chip"
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

              <fieldset className="option-group">
                <legend>Beden</legend>
                <div className="option-row">
                  {visibleVariants.map((variant) => (
                    <button
                      className="option-chip"
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

              <p className="availability-line">
                {selectedVariant
                  ? `${selectedVariant.size} · ${stockStatusLabel(selectedVariant.availability)}${selectedVariant.selectable ? ' ✓' : ''}`
                  : stockStatusLabel(detail.availability)}
              </p>

              {selectedOffer?.checkoutUrl ? (
                <a
                  className="checkout-link"
                  href={selectedOffer.checkoutUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Satın Al ↗
                </a>
              ) : (
                <button className="checkout-disabled" type="button" disabled>
                  Bu varyant satın alınamıyor
                </button>
              )}
            </div>
          </div>

          {detail.description ? (
            <p className="detail-description">{detail.description}</p>
          ) : null}

          {detail.similarProducts.length ? (
            <section className="similar-section" aria-label="Benzer ürünler">
              <h3>Benzer ürünler</h3>
              <div className="product-grid">
                {detail.similarProducts.map((item) => (
                  <ShoppingProductCard
                    key={item.offerId}
                    item={item}
                    disabled={loading}
                    onInspect={(next) => void openDetail(next.productId)}
                  />
                ))}
              </div>
            </section>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Root element missing');
if (root.dataset.dtoVersion && Number(root.dataset.dtoVersion) !== DTO_VERSION)
  throw new Error('Widget shell DTO version mismatch');
createRoot(root).render(<Widget />);
