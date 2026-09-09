'use client';

import { useEffect, useState } from 'react';
import { useActiveMerchant } from '../merchant-context';

const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';

type Report = {
  range: { from: string; to: string; timezone: string };
  measurement: 'measured' | 'not_configured';
  metrics: {
    searchAttempts: number;
    successfulSearches: number;
    emptySearches: number;
    failedSearches: number;
    paginationRequests: number;
    noResultRate: number | null;
    searchErrorRate: number | null;
    searchesByChannel: Record<string, number>;
    humanRedirects: number;
    botPreviews: number;
    attributedSales: number | null;
    netRevenueMinor: number | null;
    conversionRate: number | null;
  };
};

export default function AnalyticsPage() {
  const { merchantId } = useActiveMerchant();
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    setReport(null);
    setError('');
    const controller = new AbortController();
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    void fetch(
      `${api}/v1/merchants/${merchantId}/analytics?timezone=${encodeURIComponent(timezone)}`,
      { credentials: 'include', signal: controller.signal },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error('Rapor alınamadı.');
        setReport(await response.json());
      })
      .catch((reason) => {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error ? reason.message : 'Rapor alınamadı.',
          );
      });
    return () => controller.abort();
  }, [merchantId]);
  if (error)
    return (
      <main>
        <h1>Raporlar</h1>
        <p role="alert">{error}</p>
      </main>
    );
  if (!report)
    return (
      <main>
        <h1>Raporlar</h1>
        <p>Rapor yükleniyor…</p>
      </main>
    );
  return (
    <main>
      <h1>Mağaza raporları</h1>
      <p>
        {new Date(report.range.from).toLocaleString('tr-TR')} –{' '}
        {new Date(report.range.to).toLocaleString('tr-TR')} (
        {report.range.timezone})
      </p>
      <dl>
        <dt>Arama denemesi</dt>
        <dd>{report.metrics.searchAttempts}</dd>
        <dt>Sonuç bulunamayan arama</dt>
        <dd>
          {report.metrics.emptySearches}
          {report.metrics.noResultRate === null
            ? ''
            : ` (%${(report.metrics.noResultRate * 100).toFixed(1)})`}
        </dd>
        <dt>Arama hatası</dt>
        <dd>
          {report.metrics.failedSearches}
          {report.metrics.searchErrorRate === null
            ? ''
            : ` (%${(report.metrics.searchErrorRate * 100).toFixed(1)})`}
        </dd>
        <dt>Web araması</dt>
        <dd>{report.metrics.searchesByChannel.web ?? 0}</dd>
        <dt>ChatGPT araması</dt>
        <dd>{report.metrics.searchesByChannel.mcp ?? 0}</dd>
        <dt>Ürün etkileşimi / insan yönlendirmesi</dt>
        <dd>{report.metrics.humanRedirects}</dd>
        <dt>Bot önizlemesi</dt>
        <dd>{report.metrics.botPreviews}</dd>
        <dt>Atfedilen satış</dt>
        <dd>
          {report.measurement === 'measured'
            ? report.metrics.attributedSales
            : 'Ölçülmüyor'}
        </dd>
        <dt>Net tutar</dt>
        <dd>
          {report.metrics.netRevenueMinor === null
            ? 'Ölçülmüyor'
            : `${(report.metrics.netRevenueMinor / 100).toLocaleString('tr-TR')} TL`}
        </dd>
        <dt>Dönüşüm oranı</dt>
        <dd>
          {report.metrics.conversionRate === null
            ? 'Hesaplanamıyor'
            : `%${(report.metrics.conversionRate * 100).toFixed(2)}`}
        </dd>
        <dt>Ek satış</dt>
        <dd>Ölçülmüyor — kontrol grubu yok</dd>
      </dl>
      <p>
        Atfedilen satış, ek satış anlamına gelmez. Oranın paydası insan
        yönlendirmeleridir.
      </p>
      <p>
        Sonraki sayfa istekleri ({report.metrics.paginationRequests}) arama
        oranlarına katılmaz. Sistem tarafından ayırt edilemeyen tekrarlar yeni
        arama denemesi sayılır. Arama metinleri rapor için saklanmaz.
      </p>
    </main>
  );
}
