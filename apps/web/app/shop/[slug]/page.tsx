'use client';

import {
  discoverySessionSchema,
  publicStorefrontSchema,
  searchResponseSchema,
  type PublicStorefront,
  type SearchResponse,
} from '@shopai/contracts';
import { ProductCard } from '@shopai/ui';
import { useParams } from 'next/navigation';
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';

const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';

type SearchScope = 'storefront' | 'network';

export default function BrandedStorefrontPage() {
  const { slug } = useParams<{ slug: string }>();
  const [storefront, setStorefront] = useState<PublicStorefront>();
  const [discoverySessionId, setDiscoverySessionId] = useState<string>();
  const [scope, setScope] = useState<SearchScope>('storefront');
  const [query, setQuery] = useState('');
  const [size, setSize] = useState('');
  const [result, setResult] = useState<SearchResponse>();
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState('');
  const requestSequence = useRef(0);

  const createDiscoverySession = useCallback(
    async (merchant?: string) => {
      const response = await fetch(`${api}/discovery-session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          surface: 'web',
          ...(merchant ? { merchant } : {}),
          ...(document.referrer ? { referrer: document.referrer } : {}),
        }),
      });
      if (!response.ok) throw new Error('discovery_session_failed');
      return discoverySessionSchema.parse(await response.json());
    },
    [],
  );

  const runSearch = useCallback(
    async (
      store: PublicStorefront,
      sessionId: string,
      nextScope: SearchScope,
      nextQuery = '',
      nextSize = '',
    ) => {
      const sequence = ++requestSequence.current;
      setSearching(true);
      setError('');
      try {
        const endpoint =
          nextScope === 'storefront'
            ? `${api}/v1/stores/${store.id}/search`
            : `${api}/v1/search`;
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            query: nextQuery,
            filters: {
              sizes: nextSize ? [nextSize] : [],
              inStockOnly: false,
            },
            discoverySessionId: sessionId,
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
    setStorefront(undefined);
    setDiscoverySessionId(undefined);
    setScope('storefront');
    setResult(undefined);

    void fetch(`${api}/v1/storefronts/${encodeURIComponent(slug)}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 404) {
          setMissing(true);
          return;
        }
        if (!response.ok) throw new Error('storefront_failed');
        const payload = (await response.json()) as unknown;
        const nextStorefront = publicStorefrontSchema.parse(
          (payload as { storefront: unknown }).storefront,
        );
        const session = await createDiscoverySession(nextStorefront.slug);
        if (!controller.signal.aborted) {
          setStorefront(nextStorefront);
          setDiscoverySessionId(session.id);
          await runSearch(nextStorefront, session.id, 'storefront');
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
  }, [createDiscoverySession, runSearch, slug]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (storefront && discoverySessionId)
      void runSearch(storefront, discoverySessionId, scope, query, size);
  }

  async function searchAllStores() {
    if (!storefront || scope === 'network') return;
    setSearching(true);
    setError('');
    try {
      const session = await createDiscoverySession();
      setDiscoverySessionId(session.id);
      setScope('network');
      await runSearch(storefront, session.id, 'network', query, size);
    } catch {
      setSearching(false);
      setError('Tüm mağazalar aramasına şu anda geçilemiyor.');
    }
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
        <p>Bağlantı değişmiş veya mağaza henüz herkese açık olmayabilir.</p>
      </main>
    );

  if (!storefront)
    return (
      <main className="store-shell store-message">
        <h1>Mağaza yüklenemedi.</h1>
        <p role="alert">{error}</p>
      </main>
    );

  return (
    <main
      className="store-shell"
      style={{ '--store-primary': storefront.primaryColor } as React.CSSProperties}
    >
      <header className="store-header">
        <a className="brand" href="/">
          ShopAI<span>●</span>
        </a>
        <p>{scope === 'storefront' ? `${storefront.displayName} mağazası` : 'ShopAI ağı'}</p>
      </header>

      <section className="store-intro">
        {storefront.coverImageUrl ? (
          <div
            aria-label={`${storefront.displayName} kapak görseli`}
            role="img"
            style={{
              minHeight: 180,
              borderRadius: 24,
              backgroundImage: `url(${storefront.coverImageUrl})`,
              backgroundPosition: 'center',
              backgroundSize: 'cover',
              marginBottom: 24,
            }}
          />
        ) : null}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {storefront.logoUrl ? (
            <div
              aria-label={`${storefront.displayName} logosu`}
              role="img"
              style={{
                width: 56,
                height: 56,
                borderRadius: 16,
                backgroundImage: `url(${storefront.logoUrl})`,
                backgroundPosition: 'center',
                backgroundRepeat: 'no-repeat',
                backgroundSize: 'contain',
              }}
            />
          ) : null}
          <div>
            <p className="eyebrow">
              {scope === 'storefront'
                ? `${storefront.displayName} kataloğu`
                : 'Tüm ShopAI mağazaları'}
            </p>
            <h1>{storefront.displayName}</h1>
          </div>
        </div>

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

        <button
          type="button"
          onClick={() => void searchAllStores()}
          disabled={searching || scope === 'network'}
          style={{ marginTop: 12 }}
        >
          {scope === 'network' ? 'Tüm mağazalarda aranıyor' : 'Tüm mağazalarda ara'}
        </button>
      </section>

      {error ? (
        <div className="error-state" role="alert">
          <p>{error}</p>
        </div>
      ) : null}

      {result && !result.items.length ? (
        <section className="store-empty">
          <h2>Bu koşullarda ürün bulunamadı.</h2>
          <p>Arama metnini veya beden seçimini değiştirip yeniden deneyebilirsin.</p>
        </section>
      ) : null}

      {result?.items.length ? (
        <section className="store-results">
          <div>
            <p className="eyebrow">
              {scope === 'storefront'
                ? storefront.displayName
                : 'Tüm mağazalar'}
            </p>
            <h2>{result.items.length} seçenek</h2>
          </div>
          <ul
            className="product-grid"
            aria-label={
              scope === 'storefront'
                ? `${storefront.displayName} ürünleri`
                : 'Tüm mağaza ürünleri'
            }
          >
            {result.items.map((item) => (
              <ProductCard
                key={item.offerId}
                item={item}
                demo={result.mode === 'demo'}
              />
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
