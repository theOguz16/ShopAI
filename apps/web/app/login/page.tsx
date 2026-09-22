'use client';

import { type FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';
const safeReturn = () => {
  const requested = new URLSearchParams(window.location.search).get('returnTo');
  return requested?.startsWith('/') && !requested.startsWith('//') && !requested.includes('\\')
    ? requested : '/dashboard';
};

export default function LoginPage() {
  const router = useRouter();
  const [auth0, setAuth0] = useState(false);
  const [pilotEnabled, setPilotEnabled] = useState(true);
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [sessionMessage, setSessionMessage] = useState('');
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    if (query.get('reason') === 'session_expired')
      setSessionMessage('Oturumunuzun süresi doldu veya erişiminiz iptal edildi. Lütfen yeniden giriş yapın.');
    fetch(`${api}/v1/auth/capabilities`, { credentials: 'include' })
      .then(async (response) => response.ok ? response.json() as Promise<{auth0Enabled: boolean;pilotEnabled: boolean}> : null)
      .then((data) => { if (data) { setAuth0(data.auth0Enabled); setPilotEnabled(data.pilotEnabled); } })
      .catch(() => undefined);
  }, []);
  const startAuth0 = (signup: boolean) => {
    const params = new URLSearchParams({ client: 'merchant', returnTo: safeReturn() });
    if (signup) params.set('signup', 'true');
    window.location.assign(`${api}/v1/auth/oidc/start?${params}`);
  };
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    try {
      const response = await fetch(`${api}/v1/auth/login`, {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, token }),
      });
      if (!response.ok) { setError('Giriş bilgileri geçersiz veya pilot erişimi devre dışı.'); return; }
      router.replace(safeReturn());
    } catch { setError('Giriş servisine ulaşılamıyor.'); }
  }
  async function claim(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    try {
      const response = await fetch(`${api}/v1/auth/oidc/claim`, {
        method: 'POST', credentials: 'include', redirect: 'follow',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ client: 'merchant', returnTo: safeReturn(), pilotEmail: email, pilotToken: token }),
      });
      // A cross-origin fetch redirect to Auth0 cannot navigate the top-level
      // browser safely. The claim endpoint returns an authorization URL below.
      if (!response.ok) { setError('Pilot hesap doğrulanamadı.'); return; }
      const data = await response.json() as { authorizationUrl?: string };
      if (!data.authorizationUrl) { setError('Auth0 yönlendirmesi başlatılamadı.'); return; }
      window.location.assign(data.authorizationUrl);
    } catch { setError('Pilot hesap bağlama başlatılamadı.'); }
  }
  async function recover(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    try {
      const response = await fetch(`${api}/v1/auth/recover`, {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ client: 'merchant', email: recoveryEmail }),
      });
      if (!response.ok) { setError('Kurtarma isteği işlenemedi.'); return; }
      setMessage('Hesap için kurtarma mümkünse e-posta adresine yönergeler gönderildi.');
    } catch { setError('Kurtarma servisine ulaşılamıyor.'); }
  }
  return (
    <main>
      <h1>Mağaza paneline giriş</h1>
      {sessionMessage ? <p role="status">{sessionMessage}</p> : null}
      {auth0 ? <section aria-label="Güvenli kullanıcı hesabı">
        <p>Doğrulanmış e-posta ile güvenli giriş yapın veya hesap oluşturun.</p>
        <button type="button" onClick={() => startAuth0(false)}>Auth0 ile giriş yap</button>
        <button type="button" onClick={() => startAuth0(true)}>Yeni hesap oluştur</button>
      </section> : null}
      {pilotEnabled ? <section aria-label="Pilot hesap">
        <p>Pilot hesabınızın e-postası ve davet koduyla giriş yapabilirsiniz.</p>
        <form onSubmit={submit}>
          <label>E-posta<input required maxLength={254} type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label>Pilot kodu<input required minLength={16} maxLength={256} type="password" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} /></label>
          <button type="submit">Pilot girişi</button>
          {auth0 ? <button type="button" onClick={() => {
            const form = document.createElement('form');
            // Keep the pilot proof in the existing form state and use the API's
            // explicit linking route rather than matching accounts by email.
            void form;
            setMessage('Mevcut pilot hesabınızı bağlamak için aşağıdaki hesabı bağla düğmesini kullanın.');
          }}>Hesabı bağlama hakkında</button> : null}
        </form>
        {auth0 ? <form onSubmit={claim}>
          <p>Pilot kodunuzla hesabın size ait olduğunu kanıtladıktan sonra Auth0 girişini tamamlayın. Kayıtlarınız ve mağaza üyeliğiniz korunur.</p>
          <button type="submit">Mevcut pilot hesabımı Auth0 ile bağla</button>
        </form> : null}
      </section> : null}
      {auth0 ? <section aria-label="Erişim kurtarma">
        <h2>Erişim kurtarma</h2>
        <form onSubmit={recover}>
          <label>E-posta<input required type="email" maxLength={254} autoComplete="email" value={recoveryEmail} onChange={(event) => setRecoveryEmail(event.target.value)} /></label>
          <button type="submit">Kurtarma e-postası iste</button>
        </form>
      </section> : null}
      {error ? <p role="alert">{error}</p> : null}
      {message ? <p role="status">{message}</p> : null}
    </main>
  );
}
