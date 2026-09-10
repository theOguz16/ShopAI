'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useActiveMerchant } from '../merchant-context';

const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';

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
  const [storeUrl, setStoreUrl] = useState('');
  const [consumerKey, setConsumerKey] = useState('');
  const [consumerSecret, setConsumerSecret] = useState('');
  const [testState, setTestState] = useState<TestState>('idle');
  const [onboardedConnectionId, setOnboardedConnectionId] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      if (!merchantId) return;
      const response = await fetch(
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
    setStoreUrl('');
    setConsumerKey('');
    setConsumerSecret('');
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
  const hasActiveWoo = connections.some(
    (connection) =>
      connection.provider === 'woocommerce' &&
      connection.authorizationStatus !== 'revoked',
  );

  function credentialsPayload() {
    return { storeUrl: storeUrl.trim(), consumerKey, consumerSecret };
  }

  async function testConnection() {
    if (!canConnect || busy) return;
    setBusy(true);
    setTestState('testing');
    setMessage('');
    try {
      const response = await fetch(
        `${api}/v1/merchants/${merchantId}/onboarding/woocommerce/test`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(credentialsPayload()),
        },
      );
      if (response.ok) {
        setTestState('success');
        setMessage('Bağlantı başarılı ✓');
      } else {
        setTestState('failed');
        setMessage('Bağlantı kurulamadı');
      }
    } catch {
      setTestState('failed');
      setMessage('Bağlantı kurulamadı');
    } finally {
      setBusy(false);
    }
  }

  async function createAndSync() {
    if (!canConnect || busy || testState !== 'success') return;
    setBusy(true);
    setStep(5);
    setMessage(
      'WooCommerce bağlantısı oluşturuluyor ve ilk sync başlatılıyor…',
    );
    try {
      const response = await fetch(
        `${api}/v1/merchants/${merchantId}/onboarding/woocommerce/connect`,
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
            ? 'Bu mağazada zaten aktif bir WooCommerce bağlantısı var.'
            : 'Bağlantı kurulamadı',
        );
        return;
      }
      const body = (await response.json()) as {
        connection: { id: string };
        sync: { status: 'queued' | 'pending_retry' };
      };
      setOnboardedConnectionId(body.connection.id);
      setConsumerKey('');
      setConsumerSecret('');
      setStoreUrl('');
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
      const response = await fetch(
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
          WooCommerce bilgilerini gir; ShopAI bağlantıyı doğrulasın ve ilk ürün
          senkronunu başlatsın. Consumer Secret daha sonra tarayıcıya geri
          gönderilmez.
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

      {canConnect && (!hasActiveWoo || step === 6) ? (
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
                className="connector-choice selected"
                type="button"
                onClick={() => setStep(3)}
              >
                <strong>WooCommerce</strong>
                <span>Canlı katalog ve stok senkronu</span>
              </button>
              <p className="panel-empty">
                MVP’de yalnızca production-ready WooCommerce connector
                gösteriliyor.
              </p>
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
              <h2>WooCommerce bilgilerini gir</h2>
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
                  onChange={(event) => setConsumerSecret(event.target.value)}
                />
              </label>
              <button type="submit">Bağlantıyı test etmeye geç</button>
            </form>
          ) : null}

          {step === 4 ? (
            <>
              <p className="eyebrow">4 · Bağlantıyı test et</p>
              <h2>ShopAI erişimi doğrulasın</h2>
              <p>
                Store URL ve API anahtarları WooCommerce’e sunucu tarafından
                doğrulanır; credential içeriği response’a eklenmez.
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
                <a className="button-link" href="/dashboard/products">
                  Ürünleri kontrol et
                </a>
              ) : null}
            </>
          ) : null}
        </section>
      ) : null}

      {canConnect && hasActiveWoo && step !== 6 ? (
        <section className="connector-wizard-card">
          <h2>WooCommerce bağlı ✓</h2>
          <p>
            Bu mağazada aktif bir WooCommerce bağlantısı zaten var. Aşağıdan
            senkron durumunu görebilirsin.
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
            <h3>{connection.provider}</h3>
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
                WooCommerce yetkisi yenilenmeli. Teknik secret referansı yerine
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
