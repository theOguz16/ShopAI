'use client';

import { useEffect, useState } from 'react';
import { authenticatedFetch } from '../../lib/authenticated-fetch';

const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';

export default function AccountPage() {
  const [checking, setChecking] = useState(true);
  const [confirmed, setConfirmed] = useState(false);
  const [closing, setClosing] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let active = true;
    fetch(`${api}/v1/auth/session`, {
      credentials: 'include',
      cache: 'no-store',
    })
      .then((response) => {
        if (!active) return;
        if (!response.ok) window.location.replace('/login');
        else setChecking(false);
      })
      .catch(() => {
        if (active) window.location.replace('/login');
      });
    return () => {
      active = false;
    };
  }, []);

  async function closeAccount() {
    if (!confirmed || closing) return;
    setClosing(true);
    setMessage('');
    try {
      const response = await authenticatedFetch(
        `${api}/v1/auth/account/close`,
        {
          method: 'POST',
        },
      );
      if (response.ok) {
        window.location.replace('/login?reason=session_expired');
        return;
      }
      const result = (await response.json()) as { code?: string };
      if (result.code === 'OWNER_TRANSFER_REQUIRED')
        setMessage(
          'Son mağaza sahibi hesabı devretmeden veya mağazayı kapatmadan hesabını pasife alamaz.',
        );
      else if (result.code === 'MFA_STEP_UP_REQUIRED')
        setMessage(
          'Bu işlem için son 5 dakika içinde iki aşamalı giriş yapmalısınız. Çıkış yapıp yeniden girin.',
        );
      else
        setMessage(
          'Hesap pasife alınamadı. Lütfen daha sonra yeniden deneyin.',
        );
    } catch {
      setMessage(
        'Hesap servisine ulaşılamıyor. Lütfen daha sonra yeniden deneyin.',
      );
    } finally {
      setClosing(false);
    }
  }

  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      const response = await authenticatedFetch(`${api}/v1/auth/logout`, {
        method: 'POST',
      });
      if (!response.ok) throw new Error('SIGN_OUT_FAILED');
      window.location.replace('/login');
    } catch {
      setMessage('Çıkış yapılamadı. Lütfen yeniden deneyin.');
      setSigningOut(false);
    }
  }

  if (checking) return <main>Oturum doğrulanıyor…</main>;
  return (
    <main>
      <a href="/">Kataloğa dön</a>
      <h1>Hesap durumu</h1>
      <button
        type="button"
        disabled={signingOut}
        onClick={() => void signOut()}
      >
        {signingOut ? 'Çıkılıyor…' : 'Çıkış yap'}
      </button>
      <p>
        Hesabı pasife almak bütün aktif oturumları sonlandırır ve yeniden girişi
        engeller. Bu işlem kişisel kayıtları, kimlik bilgilerini ve mağaza
        kayıtlarını kalıcı olarak silmez veya anonimleştirmez.
      </p>
      <p>
        Bir mağazanın son sahibiyseniz önce sahipliği devretmeniz veya mağaza
        kapatma sürecini tamamlamanız gerekir.
      </p>
      <label>
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        Hesabımın pasife alınacağını ve kayıtlarımın saklanacağını anladım.
      </label>
      <button
        type="button"
        disabled={!confirmed || closing}
        onClick={() => void closeAccount()}
      >
        {closing ? 'İşleniyor…' : 'Hesabı pasife al'}
      </button>
      {message ? <p role="alert">{message}</p> : null}
    </main>
  );
}
