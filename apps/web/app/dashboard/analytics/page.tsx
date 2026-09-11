'use client';

import { useEffect, useMemo, useState } from 'react';
import { useActiveMerchant } from '../merchant-context';
import styles from './analytics.module.css';

const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';
const DAY_MS = 86_400_000;

type RangePreset = '7' | '30' | '90' | 'custom';

type Report = {
  range: {
    from: string;
    to: string;
    timezone: string;
    semantics: string;
  };
  measurement: 'measured' | 'not_configured';
  metrics: {
    aiSearches: number;
    productViews: number;
    checkoutClicks: number;
    orders: number | null;
    attributedGmvMinor: number | null;
    netRevenueMinor: number | null;
    searchToCheckoutRate: number | null;
    checkoutToOrderRate: number | null;
    surfaceBreakdown: {
      counts: {
        chatgpt: number;
        web: number;
        other: number;
      };
      shares: {
        chatgpt: number;
        web: number;
        other: number;
      };
    };
  };
};

const integer = new Intl.NumberFormat('tr-TR');
const money = new Intl.NumberFormat('tr-TR', {
  style: 'currency',
  currency: 'TRY',
  maximumFractionDigits: 0,
});

function toDateInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function initialCustomRange() {
  const to = new Date();
  const from = new Date(to.getTime() - 29 * DAY_MS);
  return { from: toDateInput(from), to: toDateInput(to) };
}

function buildRange(preset: RangePreset, customFrom: string, customTo: string) {
  if (preset !== 'custom') {
    const to = new Date();
    const from = new Date(to.getTime() - Number(preset) * DAY_MS);
    return { from, to };
  }

  const from = new Date(`${customFrom}T00:00:00`);
  const inclusiveTo = new Date(`${customTo}T00:00:00`);
  const to = new Date(inclusiveTo);
  to.setDate(to.getDate() + 1);
  if (
    !Number.isFinite(from.getTime()) ||
    !Number.isFinite(to.getTime()) ||
    from >= to ||
    to.getTime() - from.getTime() > 93 * DAY_MS
  )
    return null;
  return { from, to };
}

function percent(value: number | null) {
  return value === null ? '—' : `%${(value * 100).toFixed(1)}`;
}

export default function AnalyticsPage() {
  const { merchantId } = useActiveMerchant();
  const defaults = useMemo(initialCustomRange, []);
  const [preset, setPreset] = useState<RangePreset>('30');
  const [customFrom, setCustomFrom] = useState(defaults.from);
  const [customTo, setCustomTo] = useState(defaults.to);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const today = useMemo(() => toDateInput(new Date()), []);
  const earliest = useMemo(
    () => toDateInput(new Date(Date.now() - 92 * DAY_MS)),
    [],
  );

  useEffect(() => {
    const range = buildRange(preset, customFrom, customTo);
    if (!range) {
      setReport(null);
      setLoading(false);
      setError('Tarih aralığı geçersiz. En fazla 93 gün seçebilirsin.');
      return;
    }

    setError('');
    setLoading(true);
    const controller = new AbortController();
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const params = new URLSearchParams({
      timezone,
      from: range.from.toISOString(),
      to: range.to.toISOString(),
    });

    void fetch(`${api}/v1/merchants/${merchantId}/analytics?${params}`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          if (response.status === 403)
            throw new Error('Bu mağazanın raporuna erişim iznin yok.');
          throw new Error('Analytics raporu alınamadı.');
        }
        setReport(await response.json());
      })
      .catch((reason) => {
        if (!controller.signal.aborted) {
          setReport(null);
          setError(
            reason instanceof Error
              ? reason.message
              : 'Analytics raporu alınamadı.',
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [merchantId, preset, customFrom, customTo]);

  const surfaces = report
    ? [
        {
          key: 'chatgpt',
          label: 'ChatGPT',
          count: report.metrics.surfaceBreakdown.counts.chatgpt,
          share: report.metrics.surfaceBreakdown.shares.chatgpt,
        },
        {
          key: 'web',
          label: 'Web',
          count: report.metrics.surfaceBreakdown.counts.web,
          share: report.metrics.surfaceBreakdown.shares.web,
        },
        {
          key: 'other',
          label: 'Other',
          count: report.metrics.surfaceBreakdown.counts.other,
          share: report.metrics.surfaceBreakdown.shares.other,
        },
      ]
    : [];

  return (
    <main className={styles.page} aria-busy={loading}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Merchant analytics</p>
          <h1 className={styles.title}>ShopAI sana ne kazandırdı?</h1>
          <p className={styles.subtitle}>
            Aramadan siparişe kadar gerçek ShopAI event ve conversion kayıtları.
          </p>
        </div>

        <div className={styles.rangeControls}>
          <label className={styles.field}>
            Tarih aralığı
            <select
              value={preset}
              onChange={(event) => setPreset(event.target.value as RangePreset)}
            >
              <option value="7">Son 7 gün</option>
              <option value="30">Son 30 gün</option>
              <option value="90">Son 90 gün</option>
              <option value="custom">Özel aralık</option>
            </select>
          </label>
          {preset === 'custom' ? (
            <>
              <label className={styles.field}>
                Başlangıç
                <input
                  type="date"
                  min={earliest}
                  max={customTo || today}
                  value={customFrom}
                  onChange={(event) => setCustomFrom(event.target.value)}
                />
              </label>
              <label className={styles.field}>
                Bitiş
                <input
                  type="date"
                  min={customFrom || earliest}
                  max={today}
                  value={customTo}
                  onChange={(event) => setCustomTo(event.target.value)}
                />
              </label>
            </>
          ) : null}
        </div>
      </header>

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      {loading ? <p className={styles.loading}>Rapor yükleniyor…</p> : null}

      {report && !loading ? (
        <>
          <p className={styles.rangeLabel}>
            {new Date(report.range.from).toLocaleDateString('tr-TR')} –{' '}
            {new Date(report.range.to).toLocaleDateString('tr-TR')} ·{' '}
            {report.range.timezone}
          </p>

          <section className={styles.kpiGrid} aria-label="Temel metrikler">
            <article className={styles.kpi}>
              <p className={styles.kpiLabel}>AI Searches</p>
              <p className={styles.kpiValue}>
                {integer.format(report.metrics.aiSearches)}
              </p>
              <p className={styles.kpiHint}>İlk sayfa ShopAI aramaları</p>
            </article>
            <article className={styles.kpi}>
              <p className={styles.kpiLabel}>Product Views</p>
              <p className={styles.kpiValue}>
                {integer.format(report.metrics.productViews)}
              </p>
              <p className={styles.kpiHint}>Gerçek ürün detay event’leri</p>
            </article>
            <article className={styles.kpi}>
              <p className={styles.kpiLabel}>Checkout Clicks</p>
              <p className={styles.kpiValue}>
                {integer.format(report.metrics.checkoutClicks)}
              </p>
              <p className={styles.kpiHint}>Bot preview hariç</p>
            </article>
            <article className={styles.kpi}>
              <p className={styles.kpiLabel}>Orders</p>
              <p className={styles.kpiValue}>
                {report.metrics.orders === null
                  ? '—'
                  : integer.format(report.metrics.orders)}
              </p>
              <p className={styles.kpiHint}>ShopAI’ye atfedilen siparişler</p>
            </article>
            <article className={styles.kpi}>
              <p className={styles.kpiLabel}>Attributed GMV</p>
              <p className={styles.kpiValue}>
                {report.metrics.attributedGmvMinor === null
                  ? '—'
                  : money.format(report.metrics.attributedGmvMinor / 100)}
              </p>
              <p className={styles.kpiHint}>İade öncesi brüt sipariş değeri</p>
            </article>
            <article className={styles.kpi}>
              <p className={styles.kpiLabel}>Net Attributed Revenue</p>
              <p className={styles.kpiValue}>
                {report.metrics.netRevenueMinor === null
                  ? '—'
                  : money.format(report.metrics.netRevenueMinor / 100)}
              </p>
              <p className={styles.kpiHint}>İadeler düşüldükten sonra</p>
            </article>
          </section>

          <section className={styles.funnelGrid} aria-label="Funnel oranları">
            <article className={styles.funnelCard}>
              <div>
                <p className={styles.funnelLabel}>Search → Checkout</p>
                <p>Aramaların checkout’a geçiş oranı</p>
              </div>
              <p className={styles.funnelValue}>
                {percent(report.metrics.searchToCheckoutRate)}
              </p>
            </article>
            <article className={styles.funnelCard}>
              <div>
                <p className={styles.funnelLabel}>Checkout → Order</p>
                <p>Checkout click’lerinin siparişe dönüşümü</p>
              </div>
              <p className={styles.funnelValue}>
                {percent(report.metrics.checkoutToOrderRate)}
              </p>
            </article>
          </section>

          <section
            className={styles.surfaceCard}
            aria-label="Surface breakdown"
          >
            <div className={styles.sectionHeader}>
              <h2>Surface breakdown</h2>
              <p>İnsan checkout click’lerinin dağılımı</p>
            </div>
            <div className={styles.surfaceRows}>
              {surfaces.map((surface) => (
                <div key={surface.key}>
                  <div className={styles.surfaceMeta}>
                    <span>{surface.label}</span>
                    <span>
                      %{(surface.share * 100).toFixed(1)} ·{' '}
                      {integer.format(surface.count)} click
                    </span>
                  </div>
                  <div className={styles.track} aria-hidden="true">
                    <div
                      className={styles.fill}
                      style={{ width: `${surface.share * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>

          {report.measurement === 'not_configured' ? (
            <p className={styles.notice}>
              Conversion callback yapılandırılmadığı için Orders, GMV ve
              Checkout → Order henüz ölçülmüyor.
            </p>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
