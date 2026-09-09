'use client';

import { type ChangeEvent, useCallback, useEffect, useState } from 'react';
import { useActiveMerchant } from '../merchant-context';

const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';

export default function ImportsPage() {
  const { merchantId } = useActiveMerchant();
  const [file, setFile] = useState<File | null>(null);
  const [runs, setRuns] = useState<
    Array<{
      id: string;
      status: string;
      rows: number;
      error?: { rows?: Array<{ line: number; message: string }> };
    }>
  >([]);
  const [message, setMessage] = useState('');
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      if (!merchantId) return;
      const response = await fetch(
        `${api}/v1/merchants/${merchantId}/imports`,
        {
          credentials: 'include',
          signal,
        },
      );
      if (response.ok && !signal?.aborted) setRuns(await response.json());
    },
    [merchantId],
  );
  useEffect(() => {
    const controller = new AbortController();
    setFile(null);
    setRuns([]);
    setMessage('');
    void refresh(controller.signal).catch(() => {
      if (!controller.signal.aborted) setMessage('Import geçmişi yüklenemedi.');
    });
    return () => controller.abort();
  }, [refresh]);
  async function upload() {
    if (!file || !merchantId) return;
    const response = await fetch(`${api}/v1/merchants/${merchantId}/imports`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'text/csv' },
      body: await file.text(),
    });
    setMessage(response.ok ? 'Dosya kuyruğa alındı.' : 'Dosya kabul edilmedi.');
    if (response.ok) {
      setFile(null);
      await refresh();
    }
  }
  return (
    <main>
      <h1>CSV katalog içe aktarma</h1>
      <p>
        Dosya önce özel depoya alınır. Yeni ürünler doğrulama ve import
        tamamlanana kadar taslaktır.
      </p>
      <input
        type="file"
        accept=".csv,text/csv"
        onChange={(event: ChangeEvent<HTMLInputElement>) =>
          setFile(event.target.files?.[0] ?? null)
        }
      />
      <button type="button" disabled={!file} onClick={() => void upload()}>
        Yükle
      </button>
      {message ? <p role="status">{message}</p> : null}
      <h2>Import geçmişi</h2>
      <ul>
        {runs.map((run) => (
          <li key={run.id}>
            {run.status} · {run.rows} satır
            {run.error?.rows?.length ? (
              <ul>
                {run.error.rows.map((error) => (
                  <li key={`${run.id}-${error.line}`}>
                    Satır {error.line}: {error.message}
                  </li>
                ))}
              </ul>
            ) : (
              ''
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
