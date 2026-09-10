'use client';

import { useCallback, useEffect, useState } from 'react';
import { useActiveMerchant } from './merchant-context';
import styles from './sync-progress-panel.module.css';

const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';

type Connection = {
  id: string;
  provider: string;
  active?: boolean;
  authorizationStatus?: string;
};

type SyncStatus = 'queued' | 'running' | 'completed' | 'partial' | 'failed';

type SyncProgress = {
  connectionId: string;
  status: SyncStatus;
  foundProducts: number;
  processedProducts: number;
  failedProducts: number;
  variants: number;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string | null;
  error: string | null;
};

const number = new Intl.NumberFormat('tr-TR');

const statusText: Record<SyncStatus, string> = {
  queued: 'Kuyrukta',
  running: 'Çalışıyor',
  completed: 'Tamamlandı',
  partial: 'Kısmi',
  failed: 'Başarısız',
};

export function SyncProgressPanel() {
  const { merchantId } = useActiveMerchant();
  const [connectionId, setConnectionId] = useState('');
  const [progress, setProgress] = useState<SyncProgress>();

  const load = useCallback(
    async (signal?: AbortSignal) => {
      let currentConnectionId = connectionId;
      if (!currentConnectionId) {
        const connectionsResponse = await fetch(
          `${api}/v1/merchants/${merchantId}/connections`,
          { credentials: 'include', signal },
        );
        if (!connectionsResponse.ok) return;
        const connections = (await connectionsResponse.json()) as Connection[];
        const woo = connections.find(
          (item) =>
            item.provider === 'woocommerce' &&
            item.active !== false &&
            item.authorizationStatus !== 'revoked',
        );
        if (!woo) {
          if (!signal?.aborted) {
            setConnectionId('');
            setProgress(undefined);
          }
          return;
        }
        currentConnectionId = woo.id;
        if (!signal?.aborted) setConnectionId(woo.id);
      }

      const response = await fetch(
        `${api}/v1/connections/${currentConnectionId}/sync-status`,
        { credentials: 'include', signal },
      );
      if (response.status === 404) {
        if (!signal?.aborted) {
          setConnectionId('');
          setProgress(undefined);
        }
        return;
      }
      if (!response.ok) return;
      if (!signal?.aborted) setProgress(await response.json());
    },
    [connectionId, merchantId],
  );

  useEffect(() => {
    setConnectionId('');
    setProgress(undefined);
  }, [merchantId]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    const active = progress?.status === 'queued' || progress?.status === 'running';
    const interval = window.setInterval(
      () => void load().catch(() => undefined),
      active || !progress ? 2000 : 30000,
    );
    return () => window.clearInterval(interval);
  }, [load, progress]);

  if (!progress) return null;

  const syncing = progress.status === 'queued' || progress.status === 'running';
  const title = syncing
    ? 'Ürünler senkronize ediliyor...'
    : progress.status === 'completed'
      ? 'Ürün senkronu tamamlandı ✓'
      : progress.status === 'partial'
        ? 'Ürün senkronu kısmen tamamlandı'
        : 'Ürün senkronu tamamlanamadı';

  return (
    <section
      className={styles.panel}
      aria-label="Katalog senkron durumu"
      aria-live="polite"
    >
      <div className={styles.heading}>
        <div>
          <h2>{title}</h2>
          <p>
            Bu ilerleme sunucuda saklanır; sayfayı yenilesen de kaldığı yerden
            görünür.
          </p>
        </div>
        <span className={styles.badge}>{statusText[progress.status]}</span>
      </div>
      <dl className={styles.metrics}>
        <div className={styles.metric}>
          <dt>Bulunan ürün</dt>
          <dd>{number.format(progress.foundProducts)}</dd>
        </div>
        <div className={styles.metric}>
          <dt>İşlenen</dt>
          <dd>{number.format(progress.processedProducts)}</dd>
        </div>
        <div className={styles.metric}>
          <dt>Başarısız</dt>
          <dd>{number.format(progress.failedProducts)}</dd>
        </div>
        <div className={styles.metric}>
          <dt>Varyant</dt>
          <dd>{number.format(progress.variants)}</dd>
        </div>
      </dl>
      {progress.error ? (
        <p className={styles.error} role="alert">
          {progress.error}
        </p>
      ) : null}
      {progress.status === 'completed' ? (
        <a className={styles.link} href="/dashboard/products">
          Ürünleri kontrol et →
        </a>
      ) : null}
    </section>
  );
}
