'use client';

import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useState } from 'react';
import { authenticatedFetch } from '../../lib/authenticated-fetch';
import { MerchantProvider } from './merchant-context';
import { SyncProgressPanel } from './sync-progress-panel';

const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [checking, setChecking] = useState(true);
  const [userId, setUserId] = useState('');
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState('');
  useEffect(() => {
    let active = true;
    fetch(`${api}/v1/auth/session`, { credentials: 'include' })
      .then(async (response) => {
        if (!active) return;
        if (response.status === 401)
          router.replace(
            `/login?reason=session_expired&returnTo=${encodeURIComponent(pathname)}`,
          );
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

  async function signOut(allSessions: boolean) {
    if (signingOut) return;
    setSigningOut(true);
    setSignOutError('');
    try {
      const response = await authenticatedFetch(
        `${api}/v1/auth/${allSessions ? 'logout-all' : 'logout'}`,
        { method: 'POST' },
      );
      if (!response.ok) throw new Error('SIGN_OUT_FAILED');
      window.location.replace('/login');
    } catch {
      setSignOutError('Oturum kapatılamadı. Lütfen yeniden deneyin.');
      setSigningOut(false);
    }
  }

  if (checking) return <main>Oturum doğrulanıyor…</main>;
  return (
    <>
      <nav aria-label="Hesap işlemleri">
        <button
          type="button"
          disabled={signingOut}
          onClick={() => void signOut(false)}
        >
          Çıkış yap
        </button>
        <button
          type="button"
          disabled={signingOut}
          onClick={() => void signOut(true)}
        >
          Tüm oturumlardan çık
        </button>
        {signOutError ? <p role="alert">{signOutError}</p> : null}
      </nav>
      <MerchantProvider key={userId}>
        <SyncProgressPanel />
        {children}
      </MerchantProvider>
    </>
  );
}
