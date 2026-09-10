'use client';

import styles from './catalog-health-panel.module.css';

export type CatalogConnectionHealth =
  | 'healthy'
  | 'stale'
  | 'pending'
  | 'attention';

export type CatalogHealthSnapshot = {
  merchantId: string;
  generatedAt: string;
  totalProducts: number;
  publishedProducts: number;
  activeProducts: number;
  inStockProducts: number;
  missingImages: number;
  missingPrices: number;
  lastSuccessfulSyncAt: string | null;
  lastSuccessfulSyncAgeMs: number | null;
  connections: Array<{
    id: string;
    provider: string;
    status: CatalogConnectionHealth;
    authorizationStatus: string;
    lastSuccessfulSyncAt: string | null;
    lastSuccessfulSyncAgeMs: number | null;
    lastSyncError: string | null;
  }>;
};

const number = new Intl.NumberFormat('tr-TR');

function relativeAge(ageMs: number | null, language: 'tr' | 'en') {
  if (ageMs === null) return language === 'tr' ? 'Henüz yok' : 'Never';
  const minutes = Math.max(0, Math.floor(ageMs / 60_000));
  if (minutes < 1)
    return language === 'tr' ? 'az önce' : 'less than a minute ago';
  if (minutes < 60)
    return language === 'tr'
      ? `${minutes} dk önce`
      : `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24)
    return language === 'tr'
      ? `${hours} saat önce`
      : `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return language === 'tr'
    ? `${days} gün önce`
    : `${days} day${days === 1 ? '' : 's'} ago`;
}

function providerName(provider: string) {
  if (provider === 'woocommerce') return 'WooCommerce';
  return provider;
}

const statusLabel: Record<CatalogConnectionHealth, string> = {
  healthy: 'Healthy ✓',
  stale: 'Stale ⚠',
  pending: 'Pending',
  attention: 'Needs attention',
};

export function CatalogHealthPanel({
  health,
}: {
  health: CatalogHealthSnapshot;
}) {
  const metrics = [
    ['Toplam ürün', health.totalProducts],
    ['Aktif ürün', health.activeProducts],
    ['Stokta', health.inStockProducts],
    ['Eksik görsel', health.missingImages],
    ['Eksik fiyat', health.missingPrices],
  ] as const;

  return (
    <section className={styles.panel} aria-labelledby="catalog-health-title">
      <div className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Katalog durumu</p>
          <h2 id="catalog-health-title">Catalog Health</h2>
        </div>
        <div className={styles.lastSync}>
          <span>Son sync</span>
          <strong>{relativeAge(health.lastSuccessfulSyncAgeMs, 'tr')}</strong>
        </div>
      </div>

      <dl className={styles.metrics}>
        {metrics.map(([label, value]) => (
          <div className={styles.metric} key={label}>
            <dt>{label}</dt>
            <dd>{number.format(value)}</dd>
          </div>
        ))}
      </dl>

      <div className={styles.connections}>
        <h3>Connection</h3>
        {health.connections.length ? (
          health.connections.map((connection) => (
            <article className={styles.connection} key={connection.id}>
              <div className={styles.connectionHeading}>
                <strong>{providerName(connection.provider)}</strong>
                <span data-status={connection.status}>
                  {statusLabel[connection.status]}
                </span>
              </div>
              <p>
                Last successful sync:{' '}
                {relativeAge(connection.lastSuccessfulSyncAgeMs, 'en')}
              </p>
              {connection.status === 'stale' ? (
                <p className={styles.warning}>⚠ Catalog may be stale</p>
              ) : null}
              {connection.status === 'attention' && connection.lastSyncError ? (
                <p className={styles.error}>{connection.lastSyncError}</p>
              ) : null}
            </article>
          ))
        ) : (
          <p className={styles.empty}>Henüz bağlı katalog kaynağı yok.</p>
        )}
      </div>
    </section>
  );
}
