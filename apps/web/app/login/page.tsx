'use client';

import { type FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [sessionMessage, setSessionMessage] = useState('');
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    if (query.get('reason') === 'session_expired')
      setSessionMessage(
        'Oturumunuzun süresi doldu veya erişiminiz iptal edildi. Lütfen yeniden giriş yapın.',
      );
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const response = await fetch(`${api}/v1/auth/login`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, token }),
    });
    if (!response.ok) {
      setError('Giriş bilgileri geçersiz.');
      return;
    }
    const requested = new URLSearchParams(window.location.search).get(
      'returnTo',
    );
    router.replace(
      requested?.startsWith('/') && !requested.startsWith('//')
        ? requested
        : '/dashboard',
    );
  }
  return (
    <main>
      <h1>Mağaza paneline giriş</h1>
      <p>Pilot hesabınızın e-postasını ve davet/kurulum kodunu girin.</p>
      {sessionMessage ? <p role="status">{sessionMessage}</p> : null}
      <form onSubmit={submit}>
        <label>
          E-posta
          <input
            required
            maxLength={254}
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label>
          Pilot kodu
          <input
            required
            minLength={16}
            maxLength={256}
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
          />
        </label>
        {error ? <p role="alert">{error}</p> : null}
        <button type="submit">Giriş yap</button>
      </form>
    </main>
  );
}
