'use client';
import { type SearchResponse, searchResponseSchema } from '@shopai/contracts';
import { ProductCard } from '@shopai/ui';
import { type FormEvent, useState } from 'react';
export default function Home() {
  const [result, setResult] = useState<SearchResponse>();
  const [lastRequest, setLastRequest] = useState<Record<string, unknown>>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function runSearch(payload: Record<string, unknown>, append = false) {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000'}/v1/search`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      if (!response.ok) throw new Error(`API yanıtı: ${response.status}`);
      const next = searchResponseSchema.parse(await response.json());
      setResult((current) =>
        append && current
          ? { ...next, items: [...current.items, ...next.items] }
          : next,
      );
    } catch {
      setError(
        'Arama tamamlanamadı. API servisinin 4000 portunda çalıştığını kontrol edin.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const size = String(values.get('size') ?? '');
    const category = String(values.get('category') ?? '');
    const payload = {
      query: values.get('query'),
      filters: {
        ...(size ? { sizes: [size] } : {}),
        ...(category ? { category } : {}),
      },
    };
    setLastRequest(payload);
    await runSearch(payload);
  }
  return (
    <main>
      <nav>
        <strong>ShopAI / foundation</strong>
        <a href="/dashboard">Geliştirme durumu</a>
      </nav>
      <h1>Aradığını tarif et.</h1>
      <p>Ürün keşif altyapısının ilk çalışan adımı.</p>
      <p className="notice">
        Geliştirme sürümü. Varsayılan katalog sentetiktir; gerçek alışveriş ve
        canlı stok sunmaz.
      </p>
      <form onSubmit={search}>
        <label className="query">
          İhtiyacın
          <input
            name="query"
            defaultValue="Siyah M beden tişört 1500 TL altında"
            maxLength={500}
          />
        </label>
        <label>
          Beden
          <select name="size" defaultValue="">
            <option value="">Metinden algıla</option>
            {['S', 'M', 'L', 'XL'].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label>
          Kategori
          <select name="category" defaultValue="">
            <option value="">Tümü</option>
            <option value="tshirt">Tişört</option>
            <option value="shirt">Gömlek</option>
            <option value="trousers">Pantolon</option>
            <option value="jacket">Ceket</option>
          </select>
        </label>
        <button type="submit" disabled={busy}>
          {busy ? 'Aranıyor…' : 'Ürünleri bul'}
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
      {result?.warnings.map((warning) => (
        <p key={warning}>{warning}</p>
      ))}
      <div aria-live="polite">
        {result && (
          <p>
            {result.items.length} sonuç · {result.mode} katalog · arama{' '}
            {result.searchId.slice(0, 8)}
          </p>
        )}
      </div>
      {result ? (
        <p>
          Yorumlama: {result.telemetry.provider}/{result.telemetry.model} ·{' '}
          {Math.round(result.telemetry.latencyMs)} ms · tahmini $
          {result.telemetry.estimatedCostUsd.toFixed(6)}
          {result.telemetry.fallback ? ' · klasik aramaya dönüldü' : ''}
        </p>
      ) : null}
      {result?.facets.categories.length ? (
        <p>
          Kategoriler:{' '}
          {result.facets.categories
            .map((facet) => `${facet.value} (${facet.count})`)
            .join(' · ')}
        </p>
      ) : null}
      {result?.facets.sizes.length ? (
        <p>
          Bedenler:{' '}
          {result.facets.sizes
            .map((facet) => `${facet.value} (${facet.count})`)
            .join(' · ')}
        </p>
      ) : null}
      {result?.facets.colors.length ? (
        <p>
          Renkler:{' '}
          {result.facets.colors
            .map((facet) => `${facet.value} (${facet.count})`)
            .join(' · ')}
        </p>
      ) : null}
      {result && result.items.length === 0 && (
        <p>Uygun ürün yok. Beden veya bütçe koşulunu değiştirebilirsin.</p>
      )}
      <section className="grid" aria-label="Ürünler">
        {result?.items.map((item) => (
          <ProductCard
            key={item.offerId}
            item={item}
            demo={result.mode === 'demo'}
          />
        ))}
      </section>
      {result?.nextCursor && lastRequest ? (
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void runSearch({ ...lastRequest, cursor: result.nextCursor }, true)
          }
        >
          Daha fazla sonuç
        </button>
      ) : null}
    </main>
  );
}
