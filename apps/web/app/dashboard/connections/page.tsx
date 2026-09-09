'use client';

import { useCallback, useEffect, useState } from 'react';
import { useActiveMerchant } from '../merchant-context';

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
  const { merchantId } = useActiveMerchant();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [credentialRefs, setCredentialRefs] = useState<
    Array<{ provider: string; credentialsRef: string }>
  >([]);
  const [selectedCredentialRef, setSelectedCredentialRef] = useState('');
  const [message, setMessage] = useState('');
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
        ? 'Bağlantı doğrulama kuyruğuna alındı.'
        : 'Pilot bağlantısı oluşturulamadı.',
    );
    await refresh();
  }

  async function connectCsv() {
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
        ? 'CSV katalog bağlantısı hazır.'
        : response.status === 409
          ? 'CSV katalog bağlantısı zaten hazır.'
          : 'CSV bağlantısı oluşturulamadı.',
    );
    await refresh();
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
    <main>
      <h1>Canlı bağlantılar</h1>
      <p>
        Pilot sağlayıcı WooCommerce’tir. Anahtarlar tarayıcıya gönderilmez;
        yalnız güvenli secret referansı sunucuda tutulur.
      </p>
      <button type="button" disabled={false} onClick={() => void connectCsv()}>
        CSV katalog bağlantısını hazırla
      </button>
      <button
        type="button"
        disabled={!selectedCredentialRef}
        onClick={() => void connectPilot()}
      >
        WooCommerce pilot bağlantısını ekle
      </button>
      <label>
        Atanmış WooCommerce bağlantısı
        <select
          value={selectedCredentialRef}
          onChange={(event) => setSelectedCredentialRef(event.target.value)}
          disabled={!credentialRefs.length}
        >
          <option value="">Atanmış bağlantı seçin</option>
          {credentialRefs
            .filter((ref) => ref.provider === 'woocommerce')
            .map((ref) => (
              <option key={ref.credentialsRef} value={ref.credentialsRef}>
                {ref.credentialsRef}
              </option>
            ))}
        </select>
      </label>
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
          {connection.authorizationStatus === 'reauthorization_required' ? (
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
          <button type="button" onClick={() => void revoke(connection.id)}>
            Bağlantıyı iptal et
          </button>
        </article>
      ))}
    </main>
  );
}
