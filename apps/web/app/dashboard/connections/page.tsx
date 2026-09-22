'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { authenticatedFetch } from '../../../lib/authenticated-fetch';
import { useActiveMerchant } from '../merchant-context';

const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';

type Provider = 'woocommerce' | 'trendyol';
type TrendyolEnvironment = 'production' | 'stage';
type Connection = {
  id: string;
  provider: string;
  active?: boolean;
  authorizationStatus: string;
  syncMode: string;
  lastSuccessfulSyncAt: string | null;
  lastFetchedAt: string | null;
  lastSyncError: string | null;
  conversionTrackingEnabled: boolean;
};

type WizardStep = 1 | 2 | 3 | 4 | 5 | 6;
type TestState = 'idle' | 'testing' | 'success' | 'failed';

const wizardSteps = [
  'Mağaza bilgileri',
  'Ürün kaynağı',
  'Connector bilgileri',
  'Bağlantıyı test et',
  'İlk sync',
  'Sonuç',
] as const;

const providerLabels: Record<Provider, string> = {
  woocommerce: 'WooCommerce',
  trendyol: 'Trendyol',
};

const freshnessLabel = (value: string | null) => {
  if (!value) return 'Henüz veri alınmadı';
  const ageMinutes = (Date.now() - new Date(value).getTime()) / 60_000;
  return ageMinutes <= 15 ? 'Güncel' : 'Gecikmiş';
};

export default function ConnectionsPage() {
  const { merchantId, activeMerchant } = useActiveMerchant();
  const canConnect = activeMerchant.role !== 'viewer';
  const canRevoke = activeMerchant.role === 'owner';
  const [connections, setConnections] = useState<Connection[]>([]);
  const [step, setStep] = useState<WizardStep>(1);
  const [provider, setProvider] = useState<Provider>('woocommerce');
  const [storeUrl, setStoreUrl] = useState('');
  const [consumerKey, setConsumerKey] = useState('');
  const [consumerSecret, setConsumerSecret] = useState('');
  const [sellerId, setSellerId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [trendyolEnvironment, setTrendyolEnvironment] =
    useState<TrendyolEnvironment>('production');
  const [testState, setTestState] = useState<TestState>('idle');
  const [onboardedConnectionId, setOnboardedConnectionId] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      if (!merchantId) return;
      const response = await authenticatedFetch(
        `${api}/v1/merchants/${merchantId}/connections`,
        { credentials: 'include', signal },
      );
      if (!response.ok) throw new Error('Bağlantılar yüklenemedi.');
      if (!signal?.aborted) setConnections(await response.json());
    },
    [merchantId],
  );

  useEffect(() => {
    const controller = new AbortController();
    setConnections([]);
    setStep(1);
    setProvider('woocommerce');
    setStoreUrl('');
    setConsumerKey('');
    setConsumerSecret('');
    setSellerId('');
    setApiKey('');
    setApiSecret('');
    setTrendyolEnvironment('production');
    setTestState('idle');
    setOnboardedConnectionId('');
    setMessage('');
    void refresh(controller.signal).catch(() => {
      if (!controller.signal.aborted) setMessage('Bağlantılar yüklenemedi.');
    });
    return () => controller.abort();
  }, [refresh]);

  useEffect(() => {
    if (step !== 6 || !onboardedConnectionId) return;
    const timer = window.setInterval(
      () => void refresh().catch(() => undefined),
      2000,
    );
    return () => window.clearInterval(timer);
  }, [step, onboardedConnectionId, refresh]);

  const onboardingConnection = useMemo(
    () => connections.find((item) => item.id === onboardedConnectionId),
    [connections, onboardedConnectionId],
  );
  const activeProviders = useMemo(
    () =>
      new Set(
        connections
          .filter((connection) => connection.authorizationStatus !== 'revoked')
          .map((connection) => connection.provider),
      ),
    [connections],
  );
  const allProvidersConnected =
    activeProviders.has('woocommerce') && activeProviders.has('trendyol');

  function chooseProvider(nextProvider: Provider) {
    if (activeProviders.has(nextProvider)) return;
    setProvider(nextProvider);
    setTestState('idle');
    setMessage('');
    setStep(3);
  }

  function credentialsPayload() {
    return provider === 'woocommerce'
      ? {
          storeUrl: storeUrl.trim(),
          consumerKey,
          consumerSecret,
        }
      : {
          sellerId: sellerId.trim(),
          apiKey,
          apiSecret,
          environment: trendyolEnvironment,
        };
  }

  function clearCredentials() {
    setStoreUrl('');
    setConsumerKey('');
    setConsumerSecret('');
    setSellerId('');
    setApiKey('');
    setApiSecret('');
  }

  async function testConnection() {
    if (!canConnect || busy) return;
    setBusy(true);
    setTestState('testing');
    setMessage('');
    try {
      const response = await authenticatedFetch(
        `${api}/v1/merchants/${merchantId}/onboarding/${provider}/test`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(credentialsPayload()),
        },
      );
      if (response.ok) {
        setTestState('success');
        setMessage(`${providerLabels[provider]} bağlantısı başarılı ✓`);
      } else {
        setTestState('failed');
        setMessage(`${providerLabels[provider]} bağlantısı kurulamadı`);
      }
    } catch {
      setTestState('failed');
      setMessage(`${providerLabels[provider]} bağlantısı kurulamadı`);
    } finally {
      setBusy(false);
    }
  }

  async function createAndSync() {
    if (!canConnect || busy || testState !== 'success') return;
    setBusy(true);
    setStep(5);
    setMessage(
      `${providerLabels[provider]} bağlantısı oluşturuluyor ve ilk sync başlatılıyor…`,
    );
    try {
      const response = await authenticatedFetch(
        `${api}/v1/merchants/${merchantId}/onboarding/${provider}/connect`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(credentialsPayload()),
        },
      );
      if (!response.ok) {
        setStep(4);
        setTestState('failed');
        setMessage(
          response.status === 409
            ? `Bu mağazada zaten aktif bir ${providerLabels[provider]} bağlantısı var.`
            : 'Bağlantı kurulamadı',
        );
        return;
      }
      const body = (await response.json()) as {
        connection: { id: string };
        sync: { status: 'queued' | 'pending_retry' };
      };
      setOnboardedConnectionId(body.connection.id);
      clearCredentials();
      setStep(6);
      setMessage(
        body.sync.status === 'queued'
          ? 'İlk senkron başlatıldı.'
          : 'Bağlantı oluşturuldu. İlk senkron otomatik olarak yeniden denenecek.',
      );
      await refresh();
    } catch {
      setStep(4);
      setMessage('Bağlantı kurulamadı');
    } finally {
      setBusy(false);
    }
  }

  async function revoke(connectionId: string) {
    if (!canRevoke || busy) return;
    setBusy(true);
    try {
      const response = await authenticatedFetch(
        `${api}/v1/merchants/${merchantId}/connections/${connectionId}`,
        { method: 'DELETE', credentials: 'include' },
      );
      setMessage(
        response.ok
          ? 'Bağlantı iptal edildi; yeni veri çekilmeyecek.'
          : 'Bağlantı iptal edilemedi.',
      );
      if (response.ok) {
        setOnboardedConnectionId('');
        setStep(1);
        setTestState('idle');
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="dashboard-shell">
      <a className="back-link" href="/dashboard">
        ← Panele dön
      </a>
      <header className="section-heading">
        <p className="eyebrow">Merchant onboarding</p>
        <h1>Mağazanı bağla</h1>
        <p>
          WooCommerce veya Trendyol&apos;u seç; ShopAI erişimi doğrulasın ve ilk
          ürün senkronunu otomatik başlatsın. Credential değerleri daha sonra
          tarayıcıya geri gönderilmez.
        </p>
      </header>

      <ol
        className="connector-wizard-steps"
        aria-label="Connector kurulum adımları"
      >
        {wizardSteps.map((label, index) => {
          const number = (index + 1) as WizardStep;
          return (
            <li
              key={label}
              className={
                number === step ? 'current' : number < step ? 'done' : ''
              }
              aria-current={number === step ? 'step' : undefined}
            >
              <span>{number < step ? '✓' : number}</span>
              {label}
            </li>
          );
        })}
      </ol>

      {!canConnect ? (
        <p className="role-note">
          Görüntüleyici yetkin var. Bağlantıları görebilir, onboarding
          başlatamazsın.
        </p>
      ) : null}

      {canConnect && (!allProvidersConnected || step === 6) ? (
        <section className="connector-wizard-card">
          {step === 1 ? (
            <>
              <p className="eyebrow">1 · Mağaza bilgileri</p>
              <h2>{activeMerchant.name}</h2>
              <p>
                Kurulum bu mağaza için yapılacak. Slug:{' '}
                <strong>{activeMerchant.slug}</strong>
              </p>
              <button type="button" onClick={() => setStep(2)}>
                Devam et
              </button>
            </>
          ) : null}

          {step === 2 ? (
            <>
              <p className="eyebrow">2 · Ürün kaynağı seç</p>
              <h2>Ürünlerin nerede?</h2>
              <button
                className="connector-choice"
                type="button"
                disabled={activeProviders.has('woocommerce')}
                onClick={() => chooseProvider('woocommerce')}
              >
                <strong>WooCommerce</strong>
                <span>
                  {activeProviders.has('woocommerce')
                    ? 'Zaten bağlı'
                    : 'Canlı katalog ve stok senkronu'}
                </span>
              </button>
              <button
                className="connector-choice"
                type="button"
                disabled={activeProviders.has('trendyol')}
                onClick={() => chooseProvider('trendyol')}
              >
                <strong>Trendyol</strong>
                <span>
                  {activeProviders.has('trendyol')
                    ? 'Zaten bağlı'
                    : 'Product V2 katalog, fiyat ve stok senkronu'}
                </span>
              </button>
            </>
          ) : null}

          {step === 3 ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                setTestState('idle');
                setMessage('');
                setStep(4);
              }}
            >
              <p className="eyebrow">3 · Connector bilgileri</p>
              <h2>{providerLabels[provider]} bilgilerini gir</h2>
              {provider === 'woocommerce' ? (
                <>
                  <label>
                    Store URL
                    <input
                      required
                      type="url"
                      inputMode="url"
                      placeholder="https://magazam.com"
                      value={storeUrl}
                      onChange={(event) => setStoreUrl(event.target.value)}
                    />
                  </label>
                  <label>
                    Consumer Key
                    <input
                      required
                      autoComplete="off"
                      value={consumerKey}
                      onChange={(event) => setConsumerKey(event.target.value)}
                    />
                  </label>
                  <label>
                    Consumer Secret
                    <input
                      required
                      type="password"
                      autoComplete="new-password"
                      value={consumerSecret}
                      onChange={(event) =>
                        setConsumerSecret(event.target.value)
                      }
                    />
                  </label>
                </>
              ) : (
                <>
                  <label>
                    Seller ID
                    <input
                      required
                      inputMode="numeric"
                      pattern="[0-9]+"
                      placeholder="123456"
                      value={sellerId}
                      onChange={(event) => setSellerId(event.target.value)}
                    />
                  </label>
                  <label>
                    API Key
                    <input
                      required
                      autoComplete="off"
                      value={apiKey}
                      onChange={(event) => setApiKey(event.target.value)}
                    />
                  </label>
                  <label>
                    API Secret
                    <input
                      required
                      type="password"
                      autoComplete="new-password"
                      value={apiSecret}
                      onChange={(event) => setApiSecret(event.target.value)}
                    />
                  </label>
                  <label>
                    Ortam
                    <select
                      value={trendyolEnvironment}
                      onChange={(event) =>
                        setTrendyolEnvironment(
                          event.target.value as TrendyolEnvironment,
                        )
                      }
                    >
                      <option value="production">Production</option>
                      <option value="stage">Stage / test</option>
                    </select>
                  </label>
                  {trendyolEnvironment === 'stage' ? (
                    <p className="role-note">
                      Stage kullanımı için Trendyol test erişimi ve gerekli IP
                      yetkilendirmesi hesabında hazır olmalı.
                    </p>
                  ) : null}
                </>
              )}
              <button type="submit">Bağlantıyı test etmeye geç</button>
            </form>
          ) : null}

          {step === 4 ? (
            <>
              <p className="eyebrow">4 · Bağlantıyı test et</p>
              <h2>ShopAI erişimi doğrulasın</h2>
              <p>
                {providerLabels[provider]} credential&apos;ları yalnızca sunucu
                tarafından doğrulanır; secret içeriği response&apos;a eklenmez.
              </p>
              <div className="connection-actions">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void testConnection()}
                >
                  {testState === 'testing'
                    ? 'Test ediliyor…'
                    : 'Bağlantıyı Test Et'}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setStep(3)}
                >
                  Bilgileri düzenle
                </button>
              </div>
              {message ? (
                <p
                  className={
                    testState === 'success' ? 'success-note' : 'error-note'
                  }
                  role="status"
                >
                  {message}
                </p>
              ) : null}
              {testState === 'success' ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void createAndSync()}
                >
                  Devam et ve ilk sync&apos;i başlat
                </button>
              ) : null}
            </>
          ) : null}

          {step === 5 ? (
            <>
              <p className="eyebrow">5 · İlk sync&apos;i başlat</p>
              <h2>Bağlantı hazırlanıyor…</h2>
              <p>
                Credential güvenli alana yazılıyor ve ilk katalog işi kuyruğa
                alınıyor.
              </p>
            </>
          ) : null}

          {step === 6 ? (
            <>
              <p className="eyebrow">6 · Sonuç</p>
              <h2>
                {onboardingConnection?.lastSuccessfulSyncAt
                  ? 'İlk senkron tamamlandı ✓'
                  : onboardingConnection?.lastSyncError
                    ? 'İlk senkron tamamlanamadı'
                    : 'İlk senkron çalışıyor…'}
              </h2>
              {onboardingConnection?.lastSyncError ? (
                <p className="error-note" role="alert">
                  {onboardingConnection.lastSyncError}
                </p>
              ) : (
                <p role="status">{message}</p>
              )}
              {onboardingConnection?.lastSuccessfulSyncAt ? (
                <div className="connection-actions">
                  <a className="button-link" href="/dashboard/products">
                    Ürünleri kontrol et
                  </a>
                  <a className="button-link" href="/dashboard">
                    Catalog Health&apos;ı aç
                  </a>
                </div>
              ) : null}
            </>
          ) : null}
        </section>
      ) : null}

      {canConnect && allProvidersConnected && step !== 6 ? (
        <section className="connector-wizard-card">
          <h2>WooCommerce ve Trendyol bağlı ✓</h2>
          <p>
            Bu mağazada desteklenen iki canlı katalog connector&apos;ı da aktif.
            Senkron durumlarını aşağıdan takip edebilirsin.
          </p>
        </section>
      ) : null}

      {message && step !== 4 && step !== 6 ? (
        <p role="status">{message}</p>
      ) : null}

      <section className="connection-list" aria-label="Mevcut bağlantılar">
        <h2>Mevcut bağlantılar</h2>
        {!connections.length ? (
          <p className="panel-empty">Henüz bağlantı yok.</p>
        ) : null}
        {connections.map((connection) => (
          <article key={connection.id}>
            <h3>
              {connection.provider === 'woocommerce'
                ? providerLabels.woocommerce
                : connection.provider === 'trendyol'
                  ? providerLabels.trendyol
                  : connection.provider}
            </h3>
            <p>
              Yetki: {connection.authorizationStatus} · mod:{' '}
              {connection.syncMode}
            </p>
            <p>
              Satış doğrulaması:{' '}
              {connection.conversionTrackingEnabled ? 'Etkin' : 'Ölçülmüyor'}
            </p>
            <p>
              Son başarılı senkron:{' '}
              {connection.lastSuccessfulSyncAt
                ? new Date(connection.lastSuccessfulSyncAt).toLocaleString(
                    'tr-TR',
                  )
                : 'Henüz yok'}
            </p>
            <p>
              Son veri alımı:{' '}
              {connection.lastFetchedAt
                ? new Date(connection.lastFetchedAt).toLocaleString('tr-TR')
                : 'Henüz yok'}{' '}
              · {freshnessLabel(connection.lastFetchedAt)}
            </p>
            {connection.lastSyncError ? (
              <p className="error-note" role="alert">
                Son hata: {connection.lastSyncError}
              </p>
            ) : null}
            {connection.authorizationStatus === 'reauthorization_required' ? (
              <p className="role-note">
                Connector yetkisi yenilenmeli. Teknik secret referansı yerine
                bağlantıyı iptal edip onboarding ile yeni credential gir.
              </p>
            ) : null}
            {canRevoke && connection.authorizationStatus !== 'revoked' ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void revoke(connection.id)}
              >
                Bağlantıyı iptal et
              </button>
            ) : null}
          </article>
        ))}
      </section>
    </main>
  );
}
