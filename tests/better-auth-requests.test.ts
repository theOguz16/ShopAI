import { describe, expect, it } from 'vitest';
import {
  betterAuthSignInBody,
  betterAuthSignUpBody,
} from '../apps/web/lib/better-auth-requests.js';

describe('Better Auth e-posta doğrulama dönüşü', () => {
  const webOrigin = 'https://shop.example.test';
  const callbackURL = `${webOrigin}/login?verification=complete`;

  it('kayıt isteğine web giriş sayfasını ekler', () => {
    expect(
      betterAuthSignUpBody(
        { name: 'Test', email: 'merchant@example.test', password: 'test-only' },
        webOrigin,
      ),
    ).toEqual({
      name: 'Test',
      email: 'merchant@example.test',
      password: 'test-only',
      callbackURL,
    });
  });

  it('doğrulanmamış hesapla giriş isteğine de aynı dönüşü ekler', () => {
    expect(
      betterAuthSignInBody(
        { email: 'merchant@example.test', password: 'test-only' },
        webOrigin,
      ),
    ).toEqual({
      email: 'merchant@example.test',
      password: 'test-only',
      callbackURL,
    });
  });
});
