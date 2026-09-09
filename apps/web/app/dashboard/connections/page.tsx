'use client';

import { useCallback, useEffect, useState } from 'react';
import { useActiveMerchant } from '../merchant-context';
import { OnboardingSteps } from '../onboarding-steps';

const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';

type Connection = {
  id: string;
  provider: string;
  authorizationStatus: string;
  syncMode: string;
  lastSuccessfulSyncAt: string | null;
  lastFetchedAt: string | null;
  lastSyncError: string | null;
  conversionTrackingEnabled: boolean;
};

const freshnessLabel = (value: string | null) => {
  if (!value) return 'Henüz veri alınmadı';
  const ageMinutes = (Date.now() - new Date(value).getTime()) / 60_000;
  return ageMinutes <= 15 ? 'Güncel' : 'Gecikmiş';
};

export default function ConnectionsPage() {
  const { merchantId, activeMerchant } = useActiveMerchant();
  const canEdit = activeMerchant.role !== 'viewer';
  const [connections, setConnections] = useState<Connection[]>([]);
  const [credentialRefs, setCredentialRefs] = useState<
    Array<{ provider: string; credentialsRef: string }>
  >([]);
  const [selectedCredentialRef, setSelectedCredentialRef] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      if (!merchantId) return;
      const refsResponse = await fetch(
        `${api}/v1/merchants/${merchantId}/credential-refs`,
        { credentials: 'include', signal },
      );
      if (refsResponse.ok && !signal?.aborted) {
        const refs = (await refsResponse.json())
          .credentialRefs as typeof credentialRefs;
        setCredentialRefs(refs);
        setSelectedCredentialRef(
          (current) => current || refs[0]?.credentialsRef || '',
        );
      }
      const response = await fetch(
        `${api}/v1/merchants/${merchantId}/connections`,
        { credentials: 'include', signal },
      );
      if (response.ok && !signal?.aborted)
        setConnections(await response.json());
    },
    [merchantId],
  );
  useEffect(() => {
    const controller = new AbortController();
    setConnections([]);
    setCredentialRefs([]);
    setSelectedCredentialRef('');
    setMessage('');
    void refresh(controller.signal).catch(() => {
      if (!controller.signal.aborted) setMessage('Bağlantılar yüklenemedi.');
    });
    return () => controller.abort();
  }, [refresh]);

  async function connectPilot() {
    if (!canEdit || busy) return;
    setBusy(true);
    try {
      const response = await fetch(
        `${api}/v1/merchants/${merchantId}/connections`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            provider: 'woocommerce',
            credentialsRef: selectedCredentialRef,
            syncMode: 'incremental',
          }),
        },
      );
      setMessage(
        response.ok
          ? 'WooCommerce bağlantısı doğrulanıyor.'
          : 'Bağlantı oluşturulamadı. Bilgileri kontrol edip yeniden dene.',
      );
      await refresh();
    } catch {
      setMessage(
        'Bağlantı kurulamadı. İnternet bağlantını kontrol edip yeniden dene.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function connectCsv() {
    if (!canEdit || busy) return;
    setBusy(true);
    try {
      const response = await fetch(
        `${api}/v1/merchants/${merchantId}/connections`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ provider: 'csv' }),
        },
      );
      setMessage(
        response.ok
          ? 'CSV katalog kaynağı hazır.'
          : response.status === 409
            ? 'CSV katalog kaynağı zaten hazır.'
            : 'CSV kaynağı oluşturulamadı. Yeniden dene.',
      );
      await refresh();
    } catch {
      setMessage(
        'Kaynak hazırlanamadı. İnternet bağlantını kontrol edip yeniden dene.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function reauthorize(connectionId: string) {
    const response = await fetch(
      `${api}/v1/merchants/${merchantId}/connections/${connectionId}/reauthorize`,
      {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          credentialsRef: selectedCredentialRef,
        }),
      },
    );
    setMessage(
      response.ok
        ? 'Yeniden yetkilendirme doğrulama kuyruğuna alındı.'
        : 'Yetki yenilenemedi.',
    );
    await refresh();
  }

  async function revoke(connectionId: string) {
    const response = await fetch(
      `${api}/v1/merchants/${merchantId}/connections/${connectionId}`,
      { method: 'DELETE', credentials: 'include' },
    );
    setMessage(
      response.ok
        ? 'Bağlantı iptal edildi; yeni veri çekilmeyecek.'
        : 'Bağlantı iptal edilemedi.',
    );
    await refresh();
  }

  return (
    <main className="dashboard-shell">
      <a className="back-link" href="/dashboard">
        ← Panele dön
      </a>
      <OnboardingSteps current="connect" />
      <header className="section-heading">
        <p className="eyebrow">1 · Kaynak bağla</p>
        <h1>Katalog kaynağını seç</h1>
        <p>
          Hızlı deneme için CSV yükleyebilir veya atanmış WooCommerce
          bağlantısını kullanabilirsin.
        </p>
      </header>
      {!canEdit ? (
        <p className="role-note">
          Görüntüleyici yetkin var. Bağlantıları görebilir, değiştiremezsin.
        </p>
      ) : null}
      {canEdit ? (
        <div className="connection-actions">
          <button
            type="button"
            disabled={busy}
            onClick={() => void connectCsv()}
          >
            CSV katalog bağlantısını hazırla
          </button>
          <button
            type="button"
            disabled={!selectedCredentialRef || busy}
            onClick={() => void connectPilot()}
          >
            WooCommerce pilot bağlantısını ekle
          </button>
        </div>
      ) : null}
      <label>
        Atanmış WooCommerce bağlantısı
        <select
          value={selectedCredentialRef}
          onChange={(event) => setSelectedCredentialRef(event.target.value)}
          disabled={
            !credentialRefs.some((ref) => ref.provider === 'woocommerce')
          }
        >
          <option value="">Atanmış bağlantı seçin</option>
          {credentialRefs
            .filter((ref) => ref.provider === 'woocommerce')
            .map((ref) => (
              <option key={ref.credentialsRef} value={ref.credentialsRef}>
                WooCommerce bağlantısı{' '}
                {credentialRefs
                  .filter((item) => item.provider === 'woocommerce')
                  .findIndex(
                    (item) => item.credentialsRef === ref.credentialsRef,
                  ) + 1}
              </option>
            ))}
        </select>
      </label>
      {!credentialRefs.some((ref) => ref.provider === 'woocommerce') ? (
        <p className="panel-empty">
          WooCommerce bağlantısı henüz mağazana atanmadı. Pilot yöneticinden
          bağlantıyı mağazana atamasını iste veya CSV ile devam et.
        </p>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
      {connections.map((connection) => (
        <article key={connection.id}>
          <h2>{connection.provider}</h2>
          <p>
            Yetki: {connection.authorizationStatus} · mod: {connection.syncMode}
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
            · {freshnessLabel(connection.lastFetchedAt)} (15 dakika politikası)
          </p>
          {connection.lastSyncError ? (
            <p role="alert">Son hata: {connection.lastSyncError}</p>
          ) : null}
          {connection.authorizationStatus === 'reauthorization_required' &&
          canEdit ? (
            <div role="alert">
              <p>WooCommerce yetkisi yenilenmeli.</p>
              <button
                type="button"
                onClick={() => void reauthorize(connection.id)}
              >
                Yetkiyi yeniden doğrula
              </button>
            </div>
          ) : null}
          {canEdit ? (
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
    </main>
  );
}
