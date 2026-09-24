'use client';

import { useEffect, useState } from 'react';

type Choice = 'light' | 'dark' | 'system';

/*
 * Yalnızca /design referans sayfasında kullanılan tema değiştirici.
 * layout.tsx'teki başlangıç script'iyle aynı sözleşmeyi izler:
 * localStorage 'shopai-theme' + documentElement.dataset.shopaiTheme.
 * Gerçek kullanıcı ekranlarına bileşen olarak yerleştirilmedi;
 * temalar sistem tercihinden gelir.
 */
export function ThemeSwitch() {
  const [choice, setChoice] = useState<Choice>('system');

  useEffect(() => {
    const saved = localStorage.getItem('shopai-theme');
    if (saved === 'dark' || saved === 'light') setChoice(saved);
  }, []);

  function apply(next: Choice) {
    setChoice(next);
    const root = document.documentElement;
    if (next === 'system') {
      localStorage.removeItem('shopai-theme');
      if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
        root.dataset.shopaiTheme = 'dark';
      } else {
        delete root.dataset.shopaiTheme;
      }
      return;
    }
    localStorage.setItem('shopai-theme', next);
    if (next === 'dark') root.dataset.shopaiTheme = 'dark';
    else delete root.dataset.shopaiTheme;
  }

  const options: { key: Choice; label: string }[] = [
    { key: 'light', label: 'Light' },
    { key: 'dark', label: 'Dark' },
    { key: 'system', label: 'Sistem' },
  ];

  return (
    <div className="ds-theme-switch">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          aria-pressed={choice === o.key}
          onClick={() => apply(o.key)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
