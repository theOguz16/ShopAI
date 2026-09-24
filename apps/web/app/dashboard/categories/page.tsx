'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { authenticatedFetch } from '../../../lib/authenticated-fetch';
import { useActiveMerchant } from '../merchant-context';

const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';

type CanonicalCategory = {
  key: string;
  label: string;
  parentKey: string | null;
  active: boolean;
};

type CategoryMapping = {
  id: string;
  merchantId: string;
  connectionId: string;
  provider: string;
  sourceCategoryId: string;
  sourceCategoryName: string;
  sourceCategoryPath: string[] | null;
  canonicalCategoryKey: string | null;
  canonicalCategoryLabel: string | null;
  status: 'mapped' | 'unmapped';
  updatedAt: string;
};

type MappingResponse = {
  mappings: CategoryMapping[];
  categories: CanonicalCategory[];
};

function categoryPath(
  category: CanonicalCategory,
  byKey: ReadonlyMap<string, CanonicalCategory>,
) {
  const parent = category.parentKey ? byKey.get(category.parentKey) : undefined;
  return parent ? `${parent.label} / ${category.label}` : category.label;
}

export default function CategoryMappingsPage() {
  const { merchantId, activeMerchant } = useActiveMerchant();
  const canEdit =
    activeMerchant.role === 'owner' || activeMerchant.role === 'editor';
  const [filter, setFilter] = useState<'all' | 'mapped' | 'unmapped'>(
    'unmapped',
  );
  const [data, setData] = useState<MappingResponse>({
    mappings: [],
    categories: [],
  });
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setMessage('');
      const response = await authenticatedFetch(
        `${api}/v1/merchants/${merchantId}/category-mappings?status=${filter}`,
        { credentials: 'include', signal },
      );
      if (!response.ok) {
        if (!signal?.aborted) {
          setMessage('Kategori eşlemeleri yüklenemedi.');
          setLoading(false);
        }
        return;
      }
      const next = (await response.json()) as MappingResponse;
      if (signal?.aborted) return;
      setData(next);
      setDrafts(
        Object.fromEntries(
          next.mappings.map((mapping) => [
            mapping.id,
            mapping.canonicalCategoryKey ?? '',
          ]),
        ),
      );
      setLoading(false);
    },
    [filter, merchantId],
  );

  useEffect(() => {
    const controller = new AbortController();
    setData({ mappings: [], categories: [] });
    void refresh(controller.signal).catch(() => {
      if (!controller.signal.aborted) {
        setMessage('Kategori eşlemeleri yüklenemedi.');
        setLoading(false);
      }
    });
    return () => controller.abort();
  }, [refresh]);

  const categoriesByKey = useMemo(
    () => new Map(data.categories.map((category) => [category.key, category])),
    [data.categories],
  );

  async function save(mapping: CategoryMapping) {
    if (!canEdit || saving) return;
    setSaving(mapping.id);
    setMessage('');
    try {
      const value = drafts[mapping.id] ?? '';
      const response = await authenticatedFetch(
        `${api}/v1/merchants/${merchantId}/category-mappings/${mapping.id}`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            canonicalCategoryKey: value || null,
          }),
        },
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          code?: string;
        };
        setMessage(`Eşleme kaydedilemedi: ${body.code ?? response.status}`);
        return;
      }
      setMessage('Kategori eşlemesi kaydedildi.');
      await refresh();
    } finally {
      setSaving(null);
    }
  }

  return (
    <main className="dashboard-shell">
      <nav className="subnav">
        <a href="/dashboard">← Panele dön</a>
        <a href="/dashboard/products">Ürün kataloğu</a>
      </nav>
      <p className="eyebrow">{activeMerchant.name}</p>
      <h1>Kategori eşleme</h1>
      <p>
        Kaynak kategori bilgisi aynen korunur. ShopAI kategorisi ayrı bir
        eşlemedir; isim benzerliği tek başına otomatik eşleme yapmaz.
      </p>
      {!canEdit ? (
        <p className="role-note">
          Görüntüleyici yetkin var. Eşlemeleri inceleyebilir, değiştiremezsin.
        </p>
      ) : null}
      <label>
        Durum
        <select
          value={filter}
          onChange={(event) =>
            setFilter(event.target.value as 'all' | 'mapped' | 'unmapped')
          }
        >
          <option value="unmapped">Yalnız eşlenmemiş</option>
          <option value="mapped">Yalnız eşlenmiş</option>
          <option value="all">Tümü</option>
        </select>
      </label>
      {message ? <p role="status">{message}</p> : null}
      {loading ? <p role="status">Kategoriler yükleniyor…</p> : null}
      {!loading && !data.mappings.length ? (
        <p>Bu filtrede kategori kaydı yok.</p>
      ) : null}
      <ul>
        {data.mappings.map((mapping) => {
          const sourcePath = mapping.sourceCategoryPath?.length
            ? mapping.sourceCategoryPath.join(' / ')
            : mapping.sourceCategoryName;
          const current = mapping.canonicalCategoryKey
            ? categoriesByKey.get(mapping.canonicalCategoryKey)
            : undefined;
          return (
            <li key={mapping.id} style={{ margin: '20px 0' }}>
              <strong>{sourcePath}</strong>
              <p>
                {mapping.provider} · connection {mapping.connectionId} · source
                ID {mapping.sourceCategoryId}
              </p>
              <p>
                Durum:{' '}
                {mapping.status === 'mapped' ? 'eşlenmiş' : 'eşleme gerekli'}
                {current ? ` · ${categoryPath(current, categoriesByKey)}` : ''}
              </p>
              <label>
                ShopAI kategorisi
                <select
                  value={drafts[mapping.id] ?? ''}
                  disabled={!canEdit || saving === mapping.id}
                  onChange={(event) =>
                    setDrafts((currentDrafts) => ({
                      ...currentDrafts,
                      [mapping.id]: event.target.value,
                    }))
                  }
                >
                  <option value="">Eşlenmemiş bırak</option>
                  {data.categories.map((category) => (
                    <option key={category.key} value={category.key}>
                      {categoryPath(category, categoriesByKey)}
                    </option>
                  ))}
                </select>
              </label>{' '}
              {canEdit ? (
                <button
                  type="button"
                  disabled={saving === mapping.id}
                  onClick={() => void save(mapping)}
                >
                  {saving === mapping.id ? 'Kaydediliyor…' : 'Kaydet'}
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </main>
  );
}
