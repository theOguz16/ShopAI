#!/usr/bin/env node
// ÜRÜN-019 kanıt üretici: 320/390/1440 × light/dark kombinasyonlarında
// ana ekranları gezer, yatay taşma ve klavye focus varlığını kontrol eder,
// screenshot üretir.
// Kullanım: node scripts/design-evidence.mjs
// Ortam: DESIGN_BASE_URL (varsayılan http://127.0.0.1:3000),
//        WIDGET_BASE_URL (varsayılan http://127.0.0.1:3001),
//        EVIDENCE_DIR (varsayılan artifacts/urun-019)

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const webBase = process.env.DESIGN_BASE_URL ?? 'http://127.0.0.1:3000';
const widgetBase = process.env.WIDGET_BASE_URL ?? 'http://127.0.0.1:3001';
const outDir = process.env.EVIDENCE_DIR ?? 'artifacts/urun-019';

const widths = [320, 390, 1440];
const themes = ['light', 'dark'];

const targets = [
  { url: `${webBase}/`, name: 'storefront' },
  { url: `${webBase}/design`, name: 'design-reference' },
  { url: `${webBase}/login`, name: 'login' },
  {
    // Widget sunucusu yalnız asset servis eder; yerel host kabuğunu
    // setContent ile kuruyoruz (gerçek host bridge'i taklit etmez,
    // widget kendi host-yok durumunu gösterir).
    name: 'chatgpt-widget',
    html: `<!doctype html><html lang="tr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${widgetBase}/assets/widget-v4.css"></head>
<body><div id="root"></div><script src="${widgetBase}/assets/widget-v4.js"></script></body></html>`,
  },
];

mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const report = [];

for (const target of targets) {
  for (const width of widths) {
    for (const theme of themes) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        deviceScaleFactor: 2,
      });
      const page = await context.newPage();
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      try {
        if (target.html) {
          await page.setContent(target.html, {
            waitUntil: 'load',
            timeout: 30000,
          });
        } else {
          await page.goto(target.url, { waitUntil: 'load', timeout: 30000 });
        }
        await page.waitForTimeout(1500);

        // Yatay taşma: gerçek kullanıcı kaydırması denemesi + içerik sarkması.
        const overflow = await page.evaluate(() => {
          window.scrollTo(9999, 0);
          const scrolled = window.scrollX;
          window.scrollTo(0, 0);
          const vw = window.innerWidth;
          const offenders = [];
          for (const el of document.querySelectorAll('body *')) {
            const r = el.getBoundingClientRect();
            if (r.width > 0 && r.right > vw + 1) {
              offenders.push(
                `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} → ${Math.round(r.right)}px`,
              );
              if (offenders.length >= 3) break;
            }
          }
          return {
            scrolled,
            scrollWidth: document.documentElement.scrollWidth,
            offenders,
          };
        });

        // Klavye focus görünürlüğü (ilk odaklanılabilir öğe).
        const focus = await page.evaluate(() => {
          const el = document.querySelector('a[href], button, input, select');
          if (!el) return { focusable: false };
          el.focus();
          return {
            focusable: true,
            focused: document.activeElement === el,
          };
        });

        const overflowOk = overflow.scrolled === 0;
        const file = join(outDir, `${target.name}-${width}-${theme}.png`);
        await page.screenshot({ path: file, fullPage: true });

        report.push({
          target: target.name,
          width,
          theme,
          overflowOk,
          scrollWidth: overflow.scrollWidth,
          offenders: overflow.offenders,
          focus,
          pageErrors: errors.slice(0, 2),
          screenshot: file,
        });
        const flag = overflowOk ? '✓' : '✗';
        console.log(
          `${flag} ${target.name} ${width}px ${theme} scrollX=${overflow.scrolled} scrollW=${overflow.scrollWidth}` +
            (overflow.offenders.length
              ? ` sarkan: ${overflow.offenders.join(' | ')}`
              : ''),
        );
      } catch (error) {
        report.push({
          target: target.name,
          width,
          theme,
          error: String(error),
        });
        console.error(`✗ ${target.name} ${width}px ${theme}: ${error}`);
      }
      await context.close();
    }
  }
}

await browser.close();
writeFileSync(
  join(outDir, 'report.json'),
  `${JSON.stringify(report, null, 2)}\n`,
);

const failed = report.filter((r) => r.overflowOk === false || r.error);
console.log(
  `\n${report.length - failed.length}/${report.length} kombinasyon temiz. Rapor: ${join(outDir, 'report.json')}`,
);
if (failed.length > 0) process.exit(1);
