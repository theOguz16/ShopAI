'use client';

import {
  type PublicStore,
  type SearchResponse,
  discoverySessionSchema,
  publicStoreSchema,
  searchResponseSchema,
} from '@shopai/contracts';
import { ProductCard } from '@shopai/ui';
import { useParams, useSearchParams } from 'next/navigation';
import {
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { buildProductDetailHref } from '../../../lib/product-detail-href';

const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';
const campaignPattern = /^[a-z0-9][a-z0-9_-]{0,127}$/u;

export default function StorePage() {
  const { slug } = useParams<{ slug: string }>();
  const searchParams = useSearchParams();
  const requestedCampaign = searchParams.get('campaign')?.trim().toLowerCase();
  const campaign =
    requestedCampaign && campaignPattern.test(requestedCampaign)
      ? requestedCampaign
      : undefined;
  const [store, setStore] = useState<PublicStore>();
  const [discoverySessionId, setDiscoverySessionId] = useState<string>();
  const [query, setQuery] = useState('');
  const [size, setSize] = useState('');
  const [result, setResult] = useState<SearchResponse>();
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState('');
  const requestSequence = useRef(0);

  const search = useCallback(
    async (
      merchantId: string,
      nextQuery = '',
      nextSize = '',
      sessionId?: string,
    ) => {
      const sequence = ++requestSequence.current;
      setSearching(true);
      setError('');
      try {
        const response = await fetch(`${api}/v1/stores/${merchantId}/search`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            query: nextQuery,
            filters: { sizes: nextSize ? [nextSize] : [], inStockOnly: false },
            ...(sessionId ? { discoverySessionId: sessionId } : {}),
          }),
        });
        if (!response.ok) throw new Error('search_failed');
        const next = searchResponseSchema.parse(await response.json());
        if (sequence === requestSequence.current) setResult(next);
      } catch {
        if (sequence === requestSequence.current)
          setError('Ürünler şu anda yüklenemiyor. Yeniden deneyebilirsin.');
      } finally {
        if (sequence === requestSequence.current) setSearching(false);
      }
    },
    [],
  );

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setMissing(false);
    setError('');
    setStore(undefined);
    setDiscoverySessionId(undefined);
    setResult(undefined);
    void fetch(`${api}/v1/stores/${encodeURIComponent(slug)}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 404) {
          setMissing(true);
          return;
        }
        if (!response.ok) throw new Error('store_failed');
        const next = publicStoreSchema.parse((await response.json()).store);
        if (controller.signal.aborted) return;

        const referrer = document.referrer.trim().slice(0, 2048);
        const sessionResponse = await fetch(`${api}/discovery-session`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            surface: 'brand_widget',
            merchant: next.id,
            ...(campaign ? { campaign } : {}),
            ...(referrer ? { referrer } : {}),
          }),
        });
        if (!sessionResponse.ok) throw new Error('discovery_session_failed');
        const session = discoverySessionSchema.parse(
          await sessionResponse.json(),
        );
        if (!controller.signal.aborted) {
          setStore(next);
          setDiscoverySessionId(session.id);
          await search(next.id, '', '', session.id);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError(
            'Mağaza şu anda yüklenemiyor. Daha sonra yeniden deneyebilirsin.',
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
      requestSequence.current += 1;
    };
  }, [campaign, search, slug]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (store && discoverySessionId)
      void search(store.id, query, size, discoverySessionId);
  }

  if (loading)
    return (
      <main className="store-shell">
        <p role="status">Mağaza yükleniyor…</p>
      </main>
    );
  if (missing)
    return (
      <main className="store-shell store-message">
        <a className="brand" href="/">
          ShopAI<span>●</span>
        </a>
        <h1>Bu mağazayı bulamadık.</h1>
        <p>Bağlantı değişmiş veya mağaza henüz paylaşımda olmayabilir.</p>
      </main>
    );
  if (!store || !discoverySessionId)
    return (
      <main className="store-shell store-message">
        <h1>Mağaza yüklenemedi.</h1>
        <p role="alert">{error}</p>
      </main>
    );

  return (
    <main className="store-shell">
      <header className="store-header">
        <a className="brand" href="/">
          ShopAI<span>●</span>
        </a>
        <p>{store.name}</p>
      </header>
      <section className="store-intro">
        <p className="eyebrow">{store.name} kataloğu</p>
        <h1>Ne arıyorsun?</h1>
        <form className="store-search" onSubmit={submit}>
          <label>
            Ürünü tarif et
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Örn. siyah günlük tişört"
            />
          </label>
          <label>
            Beden
            <select
              value={size}
              onChange={(event) => setSize(event.target.value)}
            >
              <option value="">Tümü</option>
              {['XS', 'S', 'M', 'L', 'XL', 'XXL'].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={searching}>
            {searching ? 'Aranıyor…' : 'Ara'}
          </button>
        </form>
      </section>
      {error ? (
        <div className="error-state" role="alert">
          <p>{error}</p>
          <button
            type="button"
            onClick={() =>
              void search(store.id, query, size, discoverySessionId)
            }
          >
            Yeniden dene
          </button>
        </div>
      ) : null}
      {result && !result.items.length ? (
        <section className="store-empty">
          <h2>
            {query || size
              ? 'Bu koşullarda ürün bulunamadı.'
              : 'Bu mağazada henüz yayımlanmış ürün yok.'}
          </h2>
          <p>
            {query || size
              ? 'Arama metnini veya beden seçimini değiştirip yeniden deneyebilirsin.'
              : 'Mağaza ürünlerini hazırlıyor. Daha sonra tekrar bakabilirsin.'}
          </p>
        </section>
      ) : null}
      {result?.items.length ? (
        <section className="store-results">
          <div>
            <p className="eyebrow">Yayımlanmış ürünler</p>
            <h2>{result.items.length} seçenek</h2>
          </div>
          <ul className="product-grid" aria-label={`${store.name} ürünleri`}>
            {result.items.map((item) => (
              <ProductCard
                key={item.offerId}
                item={item}
                demo={result.mode === 'demo'}
                detailHref={buildProductDetailHref({
                  productId: item.productId,
                  searchId: result.searchId,
                  discoverySessionId,
                })}
              />
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
