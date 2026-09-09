'use client';

import {
  type ChangeEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useActiveMerchant } from '../merchant-context';
import { OnboardingSteps } from '../onboarding-steps';

const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';
type Run = {
  id: string;
  status: string;
  rows: number;
  error?: { rows?: Array<{ line: number; message: string }> };
};
const terminal = new Set(['completed', 'failed']);

function friendlyError(message: string) {
  if (message.includes('priceMinor') || message.includes('price'))
    return 'Fiyat kuruş cinsinden yalnız rakam olmalı (ör. 129900).';
  if (message.includes('checkoutUrl') || message.includes('HTTPS'))
    return 'Ürün bağlantısı https:// ile başlayan geçerli bir adres olmalı.';
  if (message.includes('available'))
    return 'Stok alanına true, false veya boş değer yazılabilir.';
  if (message.includes('Required') || message.includes('undefined'))
    return 'Zorunlu alan eksik. Şablondaki sütun başlıklarını değiştirmeden doldur.';
  return message;
}

export default function ImportsPage() {
  const { merchantId, activeMerchant } = useActiveMerchant();
  const canEdit = activeMerchant.role !== 'viewer';
  const [file, setFile] = useState<File | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [message, setMessage] = useState('');
  const [uploading, setUploading] = useState(false);
  const [polling, setPolling] = useState(false);
  const merchantGeneration = useRef(0);
  const hasActiveRuns = runs.some((run) => !terminal.has(run.status));
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      const generation = merchantGeneration.current;
      const response = await fetch(
        `${api}/v1/merchants/${merchantId}/imports`,
        { credentials: 'include', signal },
      );
      if (!response.ok) throw new Error('history_failed');
      const next = await response.json();
      if (!signal?.aborted && generation === merchantGeneration.current)
        setRuns(next);
      return next as Run[];
    },
    [merchantId],
  );

  useEffect(() => {
    merchantGeneration.current += 1;
    const controller = new AbortController();
    setFile(null);
    setRuns([]);
    setMessage('');
    setPolling(false);
    setUploading(false);
    void refresh(controller.signal)
      .then((next) => {
        if (!controller.signal.aborted)
          setPolling(next.some((run) => !terminal.has(run.status)));
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setMessage('Aktarım geçmişi yüklenemedi. Yeniden deneyebilirsin.');
      });
    return () => controller.abort();
  }, [refresh]);

  useEffect(() => {
    if (!polling || !hasActiveRuns) return;
    const generation = merchantGeneration.current;
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      void refresh()
        .then((next) => {
          if (generation !== merchantGeneration.current) return;
          if (
            !next.some((run) => !terminal.has(run.status)) ||
            attempts >= 20
          ) {
            setPolling(false);
            window.clearInterval(timer);
          }
        })
        .catch(() => {
          setMessage(
            'Aktarım durumu alınamadı. Bağlantını kontrol edip yeniden deneyebilirsin.',
          );
          setPolling(false);
          window.clearInterval(timer);
        });
    }, 1500);
    return () => window.clearInterval(timer);
  }, [hasActiveRuns, polling, refresh]);

  async function upload() {
    if (!file || !merchantId || !canEdit || uploading) return;
    setUploading(true);
    setMessage('');
    const generation = merchantGeneration.current;
    try {
      const response = await fetch(
        `${api}/v1/merchants/${merchantId}/imports`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'text/csv' },
          body: await file.text(),
        },
      );
      if (!response.ok) throw new Error('upload_failed');
      if (generation !== merchantGeneration.current) return;
      setMessage('Dosya alındı. Ürünler kontrol ediliyor…');
      setFile(null);
      const next = await refresh();
      setPolling(next.some((run) => !terminal.has(run.status)));
    } catch {
      if (generation === merchantGeneration.current)
        setMessage(
          'Dosya gönderilemedi. Dosyanı ve bağlantını kontrol edip yeniden deneyebilirsin.',
        );
    } finally {
      if (generation === merchantGeneration.current) setUploading(false);
    }
  }

  return (
    <main className="dashboard-shell">
      <a className="back-link" href="/dashboard">
        ← Panele dön
      </a>
      <OnboardingSteps current="import" completed={['connect']} />
      <header className="section-heading">
        <p className="eyebrow">2 · Veri aktar</p>
        <h1>CSV kataloğunu yükle</h1>
        <p>
          Şablonu indir, her beden/renk varyantını ayrı satıra yaz ve dosyayı
          yükle.
        </p>
      </header>
      <section className="template-card">
        <div>
          <h2>Örnek katalog şablonu</h2>
          <p>
            <code>price_minor</code> kuruş cinsindedir; <code>available</code>{' '}
            true/false, ürün adresi HTTPS olmalıdır.
          </p>
        </div>
        <a
          className="secondary-link"
          href="/examples/catalog-template.csv"
          download
        >
          CSV şablonunu indir
        </a>
      </section>
      <details className="field-help">
        <summary>Alan açıklamaları ve hata örneği</summary>
        <dl>
          <dt>external_id</dt>
          <dd>Her varyant için benzersiz kimlik.</dd>
          <dt>product_key</dt>
          <dd>Aynı ürünün beden ve renklerini gruplar.</dd>
          <dt>price_minor</dt>
          <dd>1299 TL için 129900 yaz.</dd>
          <dt>checkout_url</dt>
          <dd>Müşterinin gideceği HTTPS ürün adresi.</dd>
        </dl>
        <p>
          <strong>Hatalı örnek:</strong> <code>price_minor=1.299 TL</code> kabul
          edilmez. Nokta ve para birimini kaldırıp <code>129900</code> yaz.
        </p>
      </details>
      {canEdit ? (
        <section className="upload-card">
          <label>
            CSV dosyan
            <input
              type="file"
              accept=".csv,text/csv"
              disabled={uploading}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                setFile(event.target.files?.[0] ?? null)
              }
            />
          </label>
          <button
            type="button"
            disabled={!file || uploading}
            onClick={() => void upload()}
          >
            {uploading ? 'Gönderiliyor…' : 'Dosyayı yükle'}
          </button>
        </section>
      ) : (
        <p className="role-note">
          Görüntüleyici yetkin var. Aktarım geçmişini görebilir, yeni dosya
          yükleyemezsin.
        </p>
      )}
      {message ? (
        <p className="panel-status" role="status">
          {message}
        </p>
      ) : null}
      <section className="run-list">
        <div className="list-heading">
          <h2>Aktarım geçmişi</h2>
          {polling ? <span role="status">Durum güncelleniyor…</span> : null}
        </div>
        {!runs.length ? (
          <div className="panel-empty">
            <h3>Henüz dosya yüklenmedi.</h3>
            <p>İlk ürününü eklemek için yukarıdaki şablonla başlayabilirsin.</p>
          </div>
        ) : (
          <ul>
            {[...runs].reverse().map((run) => (
              <li key={run.id}>
                <div>
                  <strong>
                    {run.status === 'completed'
                      ? 'Tamamlandı'
                      : run.status === 'failed'
                        ? 'Düzeltme gerekiyor'
                        : 'İşleniyor'}
                  </strong>
                  <span>{run.rows} satır</span>
                </div>
                {run.error?.rows?.length ? (
                  <ul className="row-errors">
                    {run.error.rows.map((error) => (
                      <li key={`${run.id}-${error.line}`}>
                        <strong>Satır {error.line}</strong>
                        <span>{friendlyError(error.message)}</span>
                        <small>
                          Şablondaki biçime göre düzeltip dosyayı yeniden yükle.
                        </small>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {run.status === 'completed' ? (
                  <a href="/dashboard/products">Ürünleri kontrol et →</a>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
