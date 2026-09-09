import type { ReactNode } from 'react';
import './globals.css';
export const metadata = {
  title: 'ShopAI · Geliştirme kataloğu',
  description: 'ShopAI monorepo başlangıç uygulaması',
};
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  );
}
