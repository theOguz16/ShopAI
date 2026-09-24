#!/usr/bin/env node
// ÜRÜN-019: ShopAI design token kontrast doğrulaması.
// packages/ui/src/tokens.css içindeki light/dark token bloklarını okur,
// tanımlı renk çiftlerinin WCAG kontrast oranını hesaplar ve hedefin
// altında kalanlarda sıfırdan farklı exit kodu döner.
// Kullanım: node scripts/design-contrast-report.mjs [--md]

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const tokensPath = path.join(root, 'packages/ui/src/tokens.css');
const css = await readFile(tokensPath, 'utf8');

function parseBlock(block) {
  const vars = {};
  for (const [, name, value] of block.matchAll(
    /(--shopai-[a-z0-9-]+):\s*([^;]+);/g,
  )) {
    vars[name] = value.trim();
  }
  return vars;
}

const lightMatch = css.match(/:root,\s*\.shopai-scope\s*\{([\s\S]*?)\n\}/);
const darkMatch = css.match(/\[data-shopai-theme="dark"\]\s*\{([\s\S]*?)\n\}/);
if (!lightMatch || !darkMatch) {
  console.error('tokens.css çözümlenemedi (light/dark bloğu bulunamadı)');
  process.exit(1);
}
const themes = {
  light: parseBlock(lightMatch[1]),
  dark: parseBlock(darkMatch[1]),
};

function resolveToHex(value, vars) {
  // var(--x) referansını ve rgb(r g b / a%) biçimini (alfa 1 varsayımıyla) çöz.
  let v = value.trim();
  for (let i = 0; i < 5; i += 1) {
    const ref = v.match(/^var\((--shopai-[a-z0-9-]+)\)$/);
    if (!ref) break;
    v = vars[ref[1]] ?? '';
  }
  const rgbFn = v.match(/^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)/);
  if (rgbFn) {
    return `#${[1, 2, 3].map((i) => Number(rgbFn[i]).toString(16).padStart(2, '0')).join('')}`;
  }
  return v;
}

function channel(hex) {
  const h = hex.replace('#', '');
  const n =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h;
  return [0, 2, 4].map((i) => Number.parseInt(n.slice(i, i + 2), 16) / 255);
}

function luminance(hex) {
  const [r, g, b] = channel(hex).map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(fgHex, bgHex) {
  const l1 = luminance(fgHex);
  const l2 = luminance(bgHex);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

// [ön plan, zemin, hedef oran, açıklama]
// Metin hedefi 4.5:1 (WCAG AA normal metin); UI bileşeni/odak hedefi 3:1.
// Devre dışı bileşenler WCAG 1.4.3 kapsamı dışındadır; yalnız raporlanır.
const pairs = [
  [
    '--shopai-color-text-primary',
    '--shopai-color-bg-page',
    4.5,
    'Sayfa metni / sayfa zemini',
  ],
  [
    '--shopai-color-text-primary',
    '--shopai-color-surface',
    4.5,
    'Kart metni / kart yüzeyi',
  ],
  [
    '--shopai-color-text-secondary',
    '--shopai-color-surface',
    4.5,
    'İkincil metin / kart yüzeyi',
  ],
  [
    '--shopai-color-text-muted',
    '--shopai-color-bg-page',
    4.5,
    'Sönük metin / sayfa zemini',
  ],
  [
    '--shopai-color-text-muted',
    '--shopai-color-surface',
    4.5,
    'Sönük metin / kart yüzeyi',
  ],
  [
    '--shopai-color-text-on-action',
    '--shopai-color-action-primary',
    4.5,
    'Buton metni / primary buton',
  ],
  [
    '--shopai-color-text-on-inverse',
    '--shopai-color-surface-inverse',
    4.5,
    'Ters bant metni / ters bant',
  ],
  [
    '--shopai-color-on-accent',
    '--shopai-color-accent',
    4.5,
    'Vurgu üstü metin / vurgu zemini',
  ],
  [
    '--shopai-color-accent-ink',
    '--shopai-color-bg-page',
    4.5,
    'Vurgu metni / sayfa zemini',
  ],
  [
    '--shopai-color-accent-ink',
    '--shopai-color-surface',
    4.5,
    'Vurgu metni / kart yüzeyi',
  ],
  [
    '--shopai-color-action-secondary-text',
    '--shopai-color-action-secondary-bg',
    4.5,
    'Secondary buton metni',
  ],
  [
    '--shopai-color-success-text',
    '--shopai-color-success-bg',
    4.5,
    'Success durumu',
  ],
  [
    '--shopai-color-warning-text',
    '--shopai-color-warning-bg',
    4.5,
    'Warning durumu',
  ],
  ['--shopai-color-error-text', '--shopai-color-error-bg', 4.5, 'Error durumu'],
  ['--shopai-color-info-text', '--shopai-color-info-bg', 4.5, 'Info durumu'],
  [
    '--shopai-color-neutral-text',
    '--shopai-color-neutral-bg',
    4.5,
    'Neutral durum',
  ],
  [
    '--shopai-color-stock-in-stock',
    '--shopai-color-surface',
    4.5,
    'Stok: mevcut etiketi',
  ],
  [
    '--shopai-color-stock-out-of-stock',
    '--shopai-color-surface',
    4.5,
    'Stok: tükendi etiketi',
  ],
  [
    '--shopai-color-stock-unknown',
    '--shopai-color-surface',
    4.5,
    'Stok: bilinmiyor etiketi',
  ],
  [
    '--shopai-color-stock-stale',
    '--shopai-color-surface',
    4.5,
    'Stok: bayat etiketi',
  ],
  [
    '--shopai-color-focus-ring',
    '--shopai-color-bg-page',
    3,
    'Odak halkası (UI, 3:1)',
  ],
  [
    '--shopai-color-focus-ring',
    '--shopai-color-surface',
    3,
    'Odak halkası / kart yüzeyi (UI, 3:1)',
  ],
  [
    '--shopai-color-border-strong',
    '--shopai-color-surface',
    3,
    'Belirgin kenarlık (UI, 3:1)',
  ],
  [
    '--shopai-color-action-primary',
    '--shopai-color-bg-page',
    3,
    'Primary buton zemini (UI, 3:1)',
  ],
  [
    '--shopai-color-action-disabled-text',
    '--shopai-color-action-disabled-bg',
    0,
    'Devre dışı (rapor)',
  ],
];

const asMd = process.argv.includes('--md');
const rows = [];
let failed = 0;
for (const theme of ['light', 'dark']) {
  const vars = themes[theme];
  for (const [fg, bg, target, label] of pairs) {
    const fgHex = resolveToHex(vars[fg], vars);
    const bgHex = resolveToHex(vars[bg], vars);
    if (!fgHex.startsWith('#') || !bgHex.startsWith('#')) {
      rows.push([
        theme,
        label,
        fg,
        fgHex || '?',
        bgHex || '?',
        '-',
        'ÇÖZÜMLENEMEDİ',
        false,
      ]);
      failed += 1;
      continue;
    }
    const r = ratio(fgHex, bgHex);
    const ok = target === 0 || r >= target;
    if (!ok) failed += 1;
    rows.push([
      theme,
      label,
      `${fgHex} / ${bgHex}`,
      target === 0 ? '-' : `${target}:1`,
      r.toFixed(2),
      ok ? '✓' : '✗',
      ok,
    ]);
  }
}

if (asMd) {
  console.log('| Tema | Çift | Değerler | Hedef | Oran | Sonuç |');
  console.log('| --- | --- | --- | --- | --- | --- |');
  for (const [theme, label, values, target, r, mark] of rows) {
    console.log(
      `| ${theme} | ${label} | \`${values}\` | ${target} | ${r} | ${mark} |`,
    );
  }
} else {
  for (const [theme, label, values, target, r, mark] of rows) {
    console.log(
      `${mark} ${theme.padEnd(5)} ${r.padStart(6)} (hedef ${target.padEnd(4)}) ${label} [${values}]`,
    );
  }
}

if (failed > 0) {
  console.error(`\n${failed} kontrast çifti hedefin altında kaldı.`);
  process.exit(1);
}
console.log('\nTüm kontrast çiftleri hedefini karşıladı.');
