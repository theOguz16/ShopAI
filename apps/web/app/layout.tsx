import type { ReactNode } from 'react';
import './globals.css';
export const metadata = {
  title: 'ShopAI · Geliştirme kataloğu',
  description: 'ShopAI monorepo başlangıç uygulaması',
};

// Tema seçimi hydrate'ten önce yapılır ki dark temada parlaklık sıçraması
// olmasın (bkz. public/theme-init.js). ÜRÜN-019: token'lar
// @shopai/ui/tokens.css'ten gelir; dark tema
// <html data-shopai-theme="dark"> attribute'u ile açılır.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="tr" suppressHydrationWarning>
      <head>
        <script src="/theme-init.js" />
      </head>
      <body>{children}</body>
    </html>
  );
}
