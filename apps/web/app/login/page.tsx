'use client';

import { useRouter } from 'next/navigation';
import { QRCodeSVG } from 'qrcode.react';
import { type FormEvent, useEffect, useState } from 'react';
import {
  betterAuthSignInBody,
  betterAuthSignUpBody,
} from '../../lib/better-auth-requests';
import { totpSetupKey } from '../../lib/totp-setup';

const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';
const safeReturn = () => {
  const requested = new URLSearchParams(window.location.search).get('returnTo');
  return requested?.startsWith('/') &&
    !requested.startsWith('//') &&
    !requested.includes('\\')
    ? requested
    : '/dashboard';
};

export default function LoginPage() {
  const router = useRouter();
  const [betterAuth, setBetterAuth] = useState(false);
  const [pilotEnabled, setPilotEnabled] = useState(true);
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [sessionMessage, setSessionMessage] = useState('');
  const [accountName, setAccountName] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [backupCode, setBackupCode] = useState('');
  const [pilotProof, setPilotProof] = useState('');
  const [totpUri, setTotpUri] = useState('');
  const [twoFactorChallenge, setTwoFactorChallenge] = useState(false);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    setResetToken(query.get('token') ?? '');
    if (query.has('error'))
      setError('E-posta doğrulama bağlantısı geçersiz veya süresi dolmuş.');
    else if (query.get('verification') === 'complete')
      setMessage(
        'Doğrulama bağlantısı işlendi. E-posta ve parolanızla devam edin.',
      );
    if (query.get('reason') === 'session_expired')
      setSessionMessage(
        'Oturumunuzun süresi doldu veya erişiminiz iptal edildi. Lütfen yeniden giriş yapın.',
      );
    fetch(`${api}/v1/auth/capabilities`, { credentials: 'include' })
      .then(async (response) =>
        response.ok
          ? (response.json() as Promise<{
              betterAuthEnabled: boolean;
              pilotEnabled: boolean;
            }>)
          : null,
      )
      .then((data) => {
        if (data) {
          setBetterAuth(data.betterAuthEnabled);
          setPilotEnabled(data.pilotEnabled);
        }
      })
      .catch(() => undefined);
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    try {
      const response = await fetch(`${api}/v1/auth/login`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, token }),
      });
      if (!response.ok) {
        setError('Giriş bilgileri geçersiz veya pilot erişimi devre dışı.');
        return;
      }
      router.replace(safeReturn());
    } catch {
      setError('Giriş servisine ulaşılamıyor.');
    }
  }
  async function betterRequest(path: string, body: unknown) {
    return fetch(`${api}/v1/auth/better/${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }
  async function createAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    try {
      const response = await betterRequest(
        'sign-up/email',
        betterAuthSignUpBody(
          { name: accountName, email, password },
          window.location.origin,
        ),
      );
      if (!response.ok) {
        setError(
          'Hesap oluşturulamadı. Bilgileri kontrol edip yeniden deneyin.',
        );
        return;
      }
      setMessage(
        'Hesap uygunsa doğrulama bağlantısı e-posta adresinize gönderildi. Bağlantıyı açtıktan sonra giriş yapın.',
      );
    } catch {
      setError('Kimlik servisine ulaşılamıyor.');
    }
  }
  async function beginBetterLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    try {
      const response = await betterRequest(
        'sign-in/email',
        betterAuthSignInBody({ email, password }, window.location.origin),
      );
      if (!response.ok) {
        setError('Giriş yapılamadı. E-postanızı doğruladığınızdan emin olun.');
        return;
      }
      const data = (await response.json()) as { twoFactorRedirect?: boolean };
      if (data.twoFactorRedirect) {
        setTotpUri('');
        setBackupCodes([]);
        setTotpCode('');
        setTwoFactorChallenge(true);
        setMessage('Doğrulayıcı uygulamanızdaki 6 haneli kodu aşağıya girin.');
        return;
      }
      setTwoFactorChallenge(false);
      const enrollment = await betterRequest('two-factor/enable', {
        method: 'totp',
        password,
      });
      if (!enrollment.ok) {
        setError('İki aşamalı doğrulama kurulumu başlatılamadı.');
        return;
      }
      const enrolled = (await enrollment.json()) as {
        totpURI?: string;
        backupCodes?: string[];
      };
      if (!enrolled.totpURI || !totpSetupKey(enrolled.totpURI)) {
        setError('Doğrulayıcı kurulum bilgisi alınamadı.');
        return;
      }
      setTotpUri(enrolled.totpURI);
      setBackupCodes(enrolled.backupCodes ?? []);
      setTotpCode('');
      setMessage(
        'Telefonunuzdaki doğrulayıcı uygulamayla QR kodunu tarayın. Sonra uygulamanın ürettiği 6 haneli kodla kurulumu onaylayın.',
      );
    } catch {
      setError('Kimlik servisine ulaşılamıyor.');
    }
  }
  async function confirmTotp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    try {
      const response = await betterRequest('two-factor/verify-totp', {
        code: totpCode,
        trustDevice: false,
      });
      if (!response.ok) {
        setError('Doğrulayıcı kodu geçersiz.');
        return;
      }
      setTotpUri('');
      setTotpCode('');
      setTwoFactorChallenge(true);
      setMessage(
        'İki aşamalı doğrulama kuruldu. Güncel kodunuzla güvenli girişi tamamlayın.',
      );
    } catch {
      setError('Kimlik servisine ulaşılamıyor.');
    }
  }
  async function completeBetterLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    try {
      const response = await fetch(`${api}/v1/auth/better/complete`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          ...(backupCode ? { backupCode } : { totp: totpCode }),
          client: 'merchant',
          ...(pilotProof ? { pilotToken: pilotProof } : {}),
        }),
      });
      if (response.status === 409) {
        setError(
          'Bu e-posta mevcut pilot hesabına ait. Eski kullanıcı ve mağaza kayıtlarınızı korumak için pilot kodunuzu girip yeni TOTP koduyla yeniden deneyin.',
        );
        return;
      }
      if (!response.ok) {
        setError('Parola, doğrulanmış e-posta veya iki aşamalı kod geçersiz.');
        return;
      }
      await betterRequest('sign-out', {});
      router.replace(safeReturn());
    } catch {
      setError('Kimlik servisine ulaşılamıyor.');
    }
  }
  async function recoverBetter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    try {
      await betterRequest('request-password-reset', {
        email: recoveryEmail,
        redirectTo: `${window.location.origin}/login`,
      });
      setMessage(
        'Hesap uygunsa sıfırlama yönergeleri e-posta adresine gönderildi.',
      );
    } catch {
      setError('Kurtarma servisine ulaşılamıyor.');
    }
  }
  async function resetBetter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    try {
      const response = await betterRequest('reset-password', {
        token: resetToken,
        newPassword,
      });
      if (!response.ok) {
        setError(
          'Bağlantı geçersiz veya süresi dolmuş. Yeni bir kurtarma bağlantısı isteyin.',
        );
        return;
      }
      setResetToken('');
      window.history.replaceState(null, '', '/login');
      setMessage(
        'Parolanız yenilendi. Giriş yaptıktan sonra iki aşamalı kodunuz gerekecek.',
      );
    } catch {
      setError('Kurtarma servisine ulaşılamıyor.');
    }
  }
  return (
    <main>
      <h1>Mağaza paneline giriş</h1>
      {sessionMessage ? <p role="status">{sessionMessage}</p> : null}
      {betterAuth ? (
        <section aria-label="Better Auth hesabı">
          <h2>Güvenli hesap</h2>
          <p>E-posta doğrulaması ve doğrulayıcı uygulama zorunludur.</p>
          {resetToken ? (
            <form onSubmit={resetBetter}>
              <label>
                Yeni parola
                <input
                  required
                  type="password"
                  minLength={8}
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                />
              </label>
              <button type="submit">Parolayı yenile</button>
            </form>
          ) : (
            <>
              <form onSubmit={createAccount}>
                <h3>Hesap oluştur</h3>
                <label>
                  Adınız
                  <input
                    required
                    value={accountName}
                    onChange={(event) => setAccountName(event.target.value)}
                  />
                </label>
                <label>
                  E-posta
                  <input
                    required
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </label>
                <label>
                  Parola
                  <input
                    required
                    type="password"
                    minLength={8}
                    autoComplete="new-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </label>
                <button type="submit">
                  Kayıt ol ve doğrulama e-postası gönder
                </button>
              </form>
              <form onSubmit={beginBetterLogin}>
                <h3>Giriş ve doğrulayıcı kurulumu</h3>
                <label>
                  E-posta
                  <input
                    required
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </label>
                <label>
                  Parola
                  <input
                    required
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </label>
                <button type="submit">E-posta ve parolayla devam et</button>
              </form>
              {totpUri ? (
                <div>
                  <p>
                    Telefonunuzdaki doğrulayıcı uygulamada hesap ekleyip QR
                    kodunu tarayın. QR kodu yalnız bu sayfada oluşturulur;
                    paylaşmayın.
                  </p>
                  <QRCodeSVG
                    value={totpUri}
                    size={220}
                    marginSize={2}
                    title="ShopAI doğrulayıcı kurulum QR kodu"
                  />
                  <details>
                    <summary>QR kodunu tarayamıyorum</summary>
                    <p>
                      Doğrulayıcı uygulamada elle kurulum seçeneğini kullanın.
                      Kurulum anahtarı gizlidir; kimseyle paylaşmayın.
                    </p>
                    <code>{totpSetupKey(totpUri)}</code>
                  </details>
                  <form onSubmit={confirmTotp}>
                    <label>
                      Uygulamadaki 6 haneli kurulum kodu
                      <input
                        required
                        inputMode="numeric"
                        pattern="[0-9]{6}"
                        value={totpCode}
                        onChange={(event) => setTotpCode(event.target.value)}
                      />
                    </label>
                    <button type="submit">Doğrulayıcıyı etkinleştir</button>
                  </form>
                </div>
              ) : null}
              {backupCodes.length ? (
                <p>
                  Yedek kodlar yalnız hesabı kurtarmak içindir; kurulum alanına
                  yazmayın. Şimdi güvenli bir yere kaydedin:{' '}
                  {backupCodes.join(' · ')}
                </p>
              ) : null}
              {twoFactorChallenge ? (
                <form onSubmit={completeBetterLogin}>
                  <h3>İki aşamalı girişi tamamla</h3>
                  <label>
                    Güncel 6 haneli kod
                    <input
                      required={!backupCode}
                      inputMode="numeric"
                      pattern="[0-9]{6}"
                      value={totpCode}
                      onChange={(event) => setTotpCode(event.target.value)}
                    />
                  </label>
                  <label>
                    Doğrulayıcıya erişemiyorsanız tek kullanımlık yedek kod
                    <input
                      type="password"
                      autoComplete="one-time-code"
                      value={backupCode}
                      onChange={(event) => setBackupCode(event.target.value)}
                    />
                  </label>
                  <label>
                    Mevcut pilot kodu (yalnız eski hesabı bağlarken)
                    <input
                      type="password"
                      autoComplete="off"
                      value={pilotProof}
                      onChange={(event) => setPilotProof(event.target.value)}
                    />
                  </label>
                  <button type="submit">Güvenli giriş</button>
                </form>
              ) : null}
              <form onSubmit={recoverBetter}>
                <h3>Parolamı unuttum</h3>
                <label>
                  E-posta
                  <input
                    required
                    type="email"
                    value={recoveryEmail}
                    onChange={(event) => setRecoveryEmail(event.target.value)}
                  />
                </label>
                <button type="submit">Sıfırlama bağlantısı iste</button>
              </form>
            </>
          )}
        </section>
      ) : null}
      {pilotEnabled ? (
        <section aria-label="Pilot hesap">
          <p>
            Pilot hesabınızın e-postası ve davet koduyla giriş yapabilirsiniz.
          </p>
          <form onSubmit={submit}>
            <label>
              E-posta
              <input
                required
                maxLength={254}
                type="email"
                autoComplete="email"
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
                autoComplete="off"
                value={token}
                onChange={(event) => setToken(event.target.value)}
              />
            </label>
            <button type="submit">Pilot girişi</button>
          </form>
        </section>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {message ? <p role="status">{message}</p> : null}
    </main>
  );
}
