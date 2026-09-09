'use client';

import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useState } from 'react';
import { MerchantProvider } from './merchant-context';

const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [checking, setChecking] = useState(true);
  const [userId, setUserId] = useState('');
  useEffect(() => {
    let active = true;
    fetch(`${api}/v1/auth/session`, { credentials: 'include' })
      .then(async (response) => {
        if (!active) return;
        if (response.status === 401)
          router.replace(`/login?returnTo=${encodeURIComponent(pathname)}`);
        else if (response.ok) {
          const body = await response.json();
          if (!active) return;
          setUserId(body.user.userId);
          setChecking(false);
        } else router.replace('/login');
      })
      .catch(() => router.replace('/login'));
    return () => {
      active = false;
    };
  }, [pathname, router]);
  if (checking) return <main>Oturum doğrulanıyor…</main>;
  return <MerchantProvider key={userId}>{children}</MerchantProvider>;
}
