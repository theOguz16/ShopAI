'use client';

import {
  createContext,
  type FormEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';

export type Merchant = {
  id: string;
  name: string;
  slug: string;
  role: 'owner' | 'editor' | 'viewer';
};

type MerchantContextValue = {
  activeMerchant: Merchant;
  merchantId: string;
  merchants: Merchant[];
  selectMerchant: (merchantId: string) => void;
};

const MerchantContext = createContext<MerchantContextValue | null>(null);

export function useActiveMerchant() {
  const value = useContext(MerchantContext);
  if (!value)
    throw new Error('Aktif mağaza bağlamı dashboard dışında kullanılamaz.');
  return value;
}

export function MerchantProvider({ children }: { children: ReactNode }) {
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [activeMerchantId, setActiveMerchantId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);

  const loadMerchants = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`${api}/v1/merchants`, {
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Mağaza listesi alınamadı.');
      const next = (await response.json()).merchants as Merchant[];
      setMerchants(next);
      setActiveMerchantId((current) => {
        if (next.length === 1) return next[0]?.id ?? '';
        return next.some((merchant) => merchant.id === current) ? current : '';
      });
    } catch {
      setMerchants([]);
      setActiveMerchantId('');
      setError('Mağazalar yüklenemedi. Lütfen yeniden giriş yapın.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setMerchants([]);
    setActiveMerchantId('');
    setName('');
    void loadMerchants();
  }, [loadMerchants]);

  async function createMerchant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || creating) return;
    setCreating(true);
    setError('');
    const response = await fetch(`${api}/v1/setup/merchant`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: name.trim() }),
    });
    if (!response.ok) {
      setError('Mağaza kurulamadı. Bilgileri kontrol edip tekrar deneyin.');
      setCreating(false);
      return;
    }
    const created = (await response.json()).merchant as Omit<Merchant, 'role'>;
    const merchant = { ...created, role: 'owner' as const };
    setMerchants([merchant]);
    setActiveMerchantId(merchant.id);
    setName('');
    setCreating(false);
  }

  const activeMerchant = merchants.find(
    (merchant) => merchant.id === activeMerchantId,
  );
  const value = useMemo(
    () =>
      activeMerchant
        ? {
            activeMerchant,
            merchantId: activeMerchant.id,
            merchants,
            selectMerchant: setActiveMerchantId,
          }
        : null,
    [activeMerchant, merchants],
  );

  if (loading) return <main>Mağazalar yükleniyor…</main>;
  if (error && !merchants.length)
    return (
      <main>
        <h1>Mağazalar yüklenemedi</h1>
        <p role="alert">{error}</p>
        <button type="button" onClick={() => void loadMerchants()}>
          Tekrar dene
        </button>
      </main>
    );
  if (!merchants.length)
    return (
      <main>
        <h1>Mağazanızı kurun</h1>
        <p>Paneli kullanmaya başlamak için mağazanıza bir ad verin.</p>
        <form onSubmit={createMerchant}>
          <label>
            Mağaza adı
            <input
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          {error ? <p role="alert">{error}</p> : null}
          <button type="submit" disabled={creating}>
            {creating ? 'Kuruluyor…' : 'Mağazayı oluştur'}
          </button>
        </form>
      </main>
    );

  if (!activeMerchant || !value)
    return (
      <main>
        <h1>Mağaza seçin</h1>
        <p>Yönetmek istediğiniz mağazayı seçin.</p>
        <label>
          Mağaza
          <select
            value={activeMerchantId}
            onChange={(event) => setActiveMerchantId(event.target.value)}
          >
            <option value="">Mağaza seçin</option>
            {merchants.map((merchant) => (
              <option key={merchant.id} value={merchant.id}>
                {merchant.name}
              </option>
            ))}
          </select>
        </label>
      </main>
    );

  return (
    <MerchantContext.Provider value={value}>
      {merchants.length > 1 ? (
        <label>
          Aktif mağaza
          <select
            value={activeMerchantId}
            onChange={(event) => setActiveMerchantId(event.target.value)}
          >
            {merchants.map((merchant) => (
              <option key={merchant.id} value={merchant.id}>
                {merchant.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {children}
    </MerchantContext.Provider>
  );
}
