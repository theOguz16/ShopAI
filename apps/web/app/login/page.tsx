'use client';

import { type FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';

const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
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
    router.replace('/dashboard');
  }
  return (
    <main>
      <h1>Mağaza paneline giriş</h1>
      <p>Pilot hesabınızın e-postasını ve davet/kurulum kodunu girin.</p>
      <form onSubmit={submit}>
        <label>
          E-posta
          <input
            required
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
