import { type SearchResponse, searchResponseSchema } from '@shopai/contracts';
import { ProductCard } from '@shopai/ui';
import { type ChangeEvent, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createHostBridge, type WidgetSearchInput } from './host-bridge.js';

const DTO_VERSION = 1;

function Widget() {
  const bridge = useMemo(() => createHostBridge(), []);
  const [input, setInput] = useState<WidgetSearchInput>(
    bridge.snapshot().input ?? {},
  );
  const [result, setResult] = useState<SearchResponse>();
  const [loading, setLoading] = useState(bridge.available);
  const [error, setError] = useState('');

  useEffect(() => {
    const unsubscribe = bridge.subscribe((snapshot) => {
      if (snapshot.input) setInput(snapshot.input);
      if (!snapshot.output) return;
      const parsed = searchResponseSchema.safeParse(snapshot.output);
      if (!parsed.success || parsed.data.schemaVersion !== DTO_VERSION) {
        setError(
          'Ürün verisi bu widget sürümüyle uyumlu değil. Aramayı sohbetten yeniden çalıştırın.',
        );
      } else {
        setResult(parsed.data);
        setError('');
      }
      setLoading(false);
    });
    return () => {
      unsubscribe();
      bridge.destroy();
    };
  }, [bridge]);

  async function changeSize(event: ChangeEvent<HTMLSelectElement>) {
    const size = event.target.value;
    const nextInput: WidgetSearchInput = {
      ...input,
      cursor: null,
      filters: { ...input.filters, sizes: size ? [size] : [] },
    };
    setInput(nextInput);
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
      setResult(searchResponseSchema.parse(await response.json()));
    } catch {
      setError('Yerel API erişilemiyor.');
    } finally {
      setLoading(false);
    }
  }

  const localHost = ['127.0.0.1', 'localhost'].includes(
    window.location.hostname,
  );
  const size = input.filters?.sizes?.[0] ?? '';
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
      {!loading && result && !result.items.length ? (
        <p role="status">
          Bu koşullara uygun ürün bulunamadı; filtreler gevşetilmedi.
        </p>
      ) : null}
      {result?.warnings.map((warning) => (
        <p key={warning}>{warning}</p>
      ))}
      <section
        aria-label="Ürün sonuçları"
        style={{
          display: 'grid',
          gap: 12,
          gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))',
        }}
      >
        {result?.items.map((item) => (
          <ProductCard
            key={item.offerId}
            item={item}
            demo={result.mode === 'demo'}
          />
        ))}
      </section>
    </main>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Root element missing');
if (root.dataset.dtoVersion && Number(root.dataset.dtoVersion) !== DTO_VERSION)
  throw new Error('Widget shell DTO version mismatch');
createRoot(root).render(<Widget />);
