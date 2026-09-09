'use client';

import {
  type SearchFilters,
  type SearchRequest,
  type SearchResponse,
  searchResponseSchema,
} from '@shopai/contracts';
import { ProductCard } from '@shopai/ui';
import { type FormEvent, useRef, useState } from 'react';

const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';
const SEARCH_TIMEOUT_MS = 10_000;
const categoryLabels: Record<string, string> = {
  tshirt: 'Tişört',
  shirt: 'Gömlek',
  trousers: 'Pantolon',
  jacket: 'Ceket',
};
const colorLabels: Record<string, string> = {
  black: 'Siyah',
  white: 'Beyaz',
  navy: 'Lacivert',
  blue: 'Mavi',
  red: 'Kırmızı',
  green: 'Yeşil',
};
type UiFilters = {
  category: string | null;
  sizes: string[] | null;
  colors: string[] | null;
  maxPriceTl: string;
};
type RetryRequest = {
  payload: SearchRequest;
  append: boolean;
  expectedSearchId?: string;
};
const emptyFilters: UiFilters = {
  category: null,
  sizes: null,
  colors: null,
  maxPriceTl: '',
};

const displayCategory = (value: string) => categoryLabels[value] ?? value;
const displayColor = (value: string) => colorLabels[value] ?? value;
function normalizedWord(value: string) {
  return value
    .toLocaleLowerCase('tr-TR')
    .replaceAll('ı', 'i')
    .replaceAll('ö', 'o')
    .replaceAll('ü', 'u')
    .replaceAll('ş', 's')
    .replaceAll('ğ', 'g')
    .replaceAll('ç', 'c');
}
function withoutQueryHint(query: string, kind: 'category' | 'budget') {
  if (kind === 'budget')
    return query
      .replace(
        /\b\d+(?:[.,]\d+)?\s*(?:(?:tl|₺|lira)\s*)?(?:ile|-|–)\s*\d+(?:[.,]\d+)?\s*(?:tl|₺|lira)?\s*(?:arası|arasında)?/giu,
        '',
      )
      .replace(
        /\b\d+(?:[.,]\d+)?\s*(?:tl|₺|lira)(?:\s*(?:altında|altı|geçmesin))?/giu,
        '',
      )
      .replace(/\s{2,}/gu, ' ')
      .trim();
  const words = Object.entries(categoryLabels).flatMap(([key, label]) => [
    key,
    normalizedWord(label),
  ]);
  return query
    .split(/\s+/u)
    .filter((word) => !words.includes(normalizedWord(word)))
    .join(' ');
}

export default function Home() {
  const [query, setQuery] = useState('Siyah M beden tişört 1500 TL altında');
  const [filters, setFilters] = useState<UiFilters>(emptyFilters);
  const [result, setResult] = useState<SearchResponse>();
  const [lastRequest, setLastRequest] = useState<SearchRequest>();
  const [retryRequest, setRetryRequest] = useState<RetryRequest>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const requestSequence = useRef(0);
  const activeController = useRef<AbortController | null>(null);

  function payloadFor(nextQuery = query, nextFilters = filters): SearchRequest {
    const explicit: Partial<SearchFilters> = {};
    if (nextFilters.category !== null) explicit.category = nextFilters.category;
    if (nextFilters.sizes !== null) explicit.sizes = nextFilters.sizes;
    if (nextFilters.colors !== null) explicit.colors = nextFilters.colors;
    const price = Number(nextFilters.maxPriceTl.replace(',', '.'));
    if (nextFilters.maxPriceTl && Number.isFinite(price) && price >= 0)
      explicit.maxPriceMinor = Math.round(price * 100);
    return { query: nextQuery, filters: explicit } as SearchRequest;
  }

  async function runSearch(
    payload: SearchRequest,
    append = false,
    expectedSearchId?: string,
  ) {
    activeController.current?.abort();
    const controller = new AbortController();
    activeController.current = controller;
    const sequence = ++requestSequence.current;
    const timeout = window.setTimeout(
      () => controller.abort(),
      SEARCH_TIMEOUT_MS,
    );
    if (!append) setResult(undefined);
    setBusy(true);
    setError('');
    setRetryRequest(undefined);
    try {
      const response = await fetch(`${api}/v1/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error('request_failed');
      const next = searchResponseSchema.parse(await response.json());
      if (sequence !== requestSequence.current) return;
      setResult((current) => {
        if (!append) return next;
        if (!current || current.searchId !== expectedSearchId) return current;
        return { ...next, items: [...current.items, ...next.items] };
      });
      if (!append) setLastRequest(payload);
    } catch {
      if (sequence !== requestSequence.current) return;
      setError(
        controller.signal.aborted
          ? 'Arama beklenenden uzun sürdü. Bağlantını kontrol edip yeniden deneyebilirsin.'
          : 'Şu anda ürünleri getiremiyoruz. Biraz sonra yeniden deneyebilirsin.',
      );
      setRetryRequest({ payload, append, expectedSearchId });
    } finally {
      window.clearTimeout(timeout);
      if (sequence === requestSequence.current) setBusy(false);
    }
  }

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void runSearch(payloadFor());
  }
  function applyFilters(next: UiFilters, nextQuery = query) {
    setFilters(next);
    setQuery(nextQuery);
    void runSearch(payloadFor(nextQuery, next));
  }
  const applied = result?.appliedFilters;

  return (
    <main className="shop-shell">
      <header className="shop-header">
        <a className="brand" href="/" aria-label="ShopAI ana sayfa">
          ShopAI<span aria-hidden="true">●</span>
        </a>
        <a className="merchant-link" href="/dashboard">
          Mağaza girişi
        </a>
      </header>
      <section className="search-intro" aria-labelledby="search-title">
        <p className="eyebrow">
          Ne aradığını anlat, seçenekleri birlikte daraltalım.
        </p>
        <h1 id="search-title">Aklındaki ürünü bul.</h1>
        <form className="search-form" onSubmit={search}>
          <label className="query-field">
            <span>Nasıl bir ürün arıyorsun?</span>
            <input
              name="query"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              maxLength={500}
              placeholder="Örn. siyah, M beden, 1500 TL altında tişört"
            />
          </label>
          <div className="filter-controls">
            <label>
              Beden
              <select
                aria-label="Beden"
                value={filters.sizes?.[0] ?? 'infer'}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    sizes:
                      event.target.value === 'infer'
                        ? null
                        : [event.target.value],
                  }))
                }
              >
                <option value="infer">Tariften algıla</option>
                {['XS', 'S', 'M', 'L', 'XL', 'XXL'].map((size) => (
                  <option key={size}>{size}</option>
                ))}
              </select>
            </label>
            <label>
              Kategori
              <select
                aria-label="Kategori"
                value={filters.category ?? 'infer'}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    category:
                      event.target.value === 'infer'
                        ? null
                        : event.target.value,
                  }))
                }
              >
                <option value="infer">Tariften algıla</option>
                {Object.entries(categoryLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              En fazla
              <span className="price-input">
                <input
                  aria-label="En yüksek fiyat"
                  inputMode="decimal"
                  min="0"
                  name="maxPrice"
                  placeholder="Tariften algıla"
                  type="number"
                  value={filters.maxPriceTl}
                  onChange={(event) =>
                    setFilters((current) => ({
                      ...current,
                      maxPriceTl: event.target.value,
                    }))
                  }
                />
                <span>₺</span>
              </span>
            </label>
            <button className="search-button" type="submit" disabled={busy}>
              {busy ? 'Aranıyor…' : 'Ürünleri bul'}
            </button>
          </div>
        </form>
      </section>

      {result ? (
        <aside className={`catalog-note ${result.mode}`}>
          <strong>
            {result.mode === 'demo' ? 'Demo katalog' : 'Mağaza kataloğu'}
          </strong>
          <span>
            {result.mode === 'demo'
              ? 'Ürünler, fiyatlar ve stoklar sentetiktir; satın alma yapılamaz.'
              : 'Fiyat ve stok güncelliğini ürün kartından kontrol edebilirsin.'}
          </span>
        </aside>
      ) : null}
      {error ? (
        <section className="error-state" role="alert">
          <p>{error}</p>
          {retryRequest ? (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void runSearch(
                  retryRequest.payload,
                  retryRequest.append,
                  retryRequest.expectedSearchId,
                )
              }
            >
              Yeniden dene
            </button>
          ) : null}
        </section>
      ) : null}

      {applied ? (
        <section className="active-filters" aria-label="Seçili filtreler">
          <div>
            <h2>Seçili filtreler</h2>
            <p>Tariften algılanan veya senin seçtiğin koşullar.</p>
          </div>
          <ul>
            {applied.sizes.map((size) => (
              <li key={`size-${size}`}>
                <button
                  type="button"
                  aria-label={`${size} beden filtresini kaldır`}
                  onClick={() => applyFilters({ ...filters, sizes: [] })}
                >
                  {size} beden <span aria-hidden="true">×</span>
                </button>
              </li>
            ))}
            {applied.colors.map((color) => (
              <li key={`color-${color}`}>
                <button
                  type="button"
                  aria-label={`${displayColor(color)} renk filtresini kaldır`}
                  onClick={() => applyFilters({ ...filters, colors: [] })}
                >
                  {displayColor(color)} <span aria-hidden="true">×</span>
                </button>
              </li>
            ))}
            {applied.category ? (
              <li>
                <button
                  type="button"
                  aria-label={`${displayCategory(applied.category)} kategori filtresini kaldır`}
                  onClick={() => {
                    const nextQuery = withoutQueryHint(query, 'category');
                    applyFilters({ ...filters, category: null }, nextQuery);
                  }}
                >
                  {displayCategory(applied.category)}{' '}
                  <span aria-hidden="true">×</span>
                </button>
              </li>
            ) : null}
            {applied.maxPriceMinor !== undefined ? (
              <li>
                <button
                  type="button"
                  aria-label="Bütçe filtresini kaldır"
                  onClick={() => {
                    const nextQuery = withoutQueryHint(query, 'budget');
                    applyFilters({ ...filters, maxPriceTl: '' }, nextQuery);
                  }}
                >
                  En fazla{' '}
                  {(applied.maxPriceMinor / 100).toLocaleString('tr-TR')} ₺{' '}
                  <span aria-hidden="true">×</span>
                </button>
              </li>
            ) : null}
            {applied.minPriceMinor !== undefined ? (
              <li>
                <button
                  type="button"
                  aria-label="Alt bütçe filtresini kaldır"
                  onClick={() => {
                    const nextQuery = withoutQueryHint(query, 'budget');
                    applyFilters(filters, nextQuery);
                  }}
                >
                  En az {(applied.minPriceMinor / 100).toLocaleString('tr-TR')}{' '}
                  ₺ <span aria-hidden="true">×</span>
                </button>
              </li>
            ) : null}
          </ul>
        </section>
      ) : null}
      {result?.warnings.length ? (
        <div className="warnings">
          {result.warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      ) : null}

      {result ? (
        <section className="results" aria-labelledby="results-title">
          <div className="results-heading" aria-live="polite">
            <div>
              <p className="eyebrow">Eşleşen seçenekler</p>
              <h2 id="results-title">{result.items.length} ürün bulundu</h2>
            </div>
          </div>
          {result.facets.categories.length ||
          result.facets.sizes.length ||
          result.facets.colors.length ? (
            <section className="facet-groups" aria-label="Sonuçları daralt">
              {result.facets.categories.length ? (
                <fieldset>
                  <legend>Kategori</legend>
                  <div>
                    {result.facets.categories.map((facet) => (
                      <button
                        type="button"
                        aria-pressed={applied?.category === facet.value}
                        key={facet.value}
                        onClick={() =>
                          applyFilters({ ...filters, category: facet.value })
                        }
                      >
                        {displayCategory(facet.value)}{' '}
                        <span>{facet.count}</span>
                      </button>
                    ))}
                  </div>
                </fieldset>
              ) : null}
              {result.facets.sizes.length ? (
                <fieldset>
                  <legend>Beden</legend>
                  <div>
                    {result.facets.sizes.map((facet) => (
                      <button
                        type="button"
                        aria-pressed={applied?.sizes.includes(facet.value)}
                        key={facet.value}
                        onClick={() =>
                          applyFilters({ ...filters, sizes: [facet.value] })
                        }
                      >
                        {facet.value} <span>{facet.count}</span>
                      </button>
                    ))}
                  </div>
                </fieldset>
              ) : null}
              {result.facets.colors.length ? (
                <fieldset>
                  <legend>Renk</legend>
                  <div>
                    {result.facets.colors.map((facet) => (
                      <button
                        type="button"
                        aria-pressed={applied?.colors.includes(facet.value)}
                        key={facet.value}
                        onClick={() =>
                          applyFilters({ ...filters, colors: [facet.value] })
                        }
                      >
                        {displayColor(facet.value)} <span>{facet.count}</span>
                      </button>
                    ))}
                  </div>
                </fieldset>
              ) : null}
            </section>
          ) : null}
          {result.items.length === 0 ? (
            <div className="empty-state">
              <h3>Bu koşullara uyan ürün bulamadık.</h3>
              <p>
                Seçili beden, renk veya bütçe koşullarından birini kaldırıp
                tekrar deneyebilirsin. Filtrelerini senin yerine gevşetmedik.
              </p>
            </div>
          ) : (
            <ul className="product-grid" aria-label="Ürünler">
              {result.items.map((item) => (
                <ProductCard
                  key={item.offerId}
                  item={item}
                  demo={result.mode === 'demo'}
                />
              ))}
            </ul>
          )}
          {result.nextCursor && lastRequest ? (
            <button
              className="more-button"
              type="button"
              disabled={busy}
              onClick={() =>
                void runSearch(
                  { ...lastRequest, cursor: result.nextCursor },
                  true,
                  result.searchId,
                )
              }
            >
              {busy ? 'Yükleniyor…' : 'Daha fazla ürün göster'}
            </button>
          ) : null}
        </section>
      ) : (
        <section className="start-state">
          <span aria-hidden="true">↳</span>
          <p>
            Tarifini yaz; beden, renk ve bütçeyi sonuçlarda düzenleyebilirsin.
          </p>
        </section>
      )}
    </main>
  );
}
