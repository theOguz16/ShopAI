import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../apps/api/src/app.js';
import { parseApiEnv } from '../../apps/api/src/env.js';
import { createDatabase } from '../../packages/db/src/client.js';
import { testTotp } from '../helpers/totp.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl)
  throw new Error('Better Auth API integration requires PostgreSQL');
const origin = 'https://web.better-auth-test.example';
const apiOrigin = 'https://api.better-auth-test.example';
const email = `ba-pilot-${randomUUID()}@example.invalid`;
const password = 'test-only-strong-password-123456';
const pilotToken = 'test-only-pilot-proof-1234567890';
const database = createDatabase(databaseUrl);
const env = parseApiEnv({
  CATALOG_MODE: 'postgres',
  DATABASE_URL: databaseUrl,
  // Exercise staging cookie policy with HTTPS origins and an isolated test DB.
  DEPLOY_ENV: 'staging',
  RELEASE_VERSION: 'test-better-auth',
  MCP_PUBLIC_ORIGIN: apiOrigin,
  MCP_ALLOWED_ORIGINS: `${origin},https://chatgpt.com`,
  WIDGET_ORIGIN: 'https://widget.better-auth-test.example',
  REDIRECT_SIGNING_SECRET: 'test-only-better-auth-redirect-secret-1234567890',
  CONNECTOR_SECRET_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  AUTH_PILOT_CREDENTIALS: JSON.stringify({ [email]: pilotToken }),
  BETTER_AUTH_ENABLED: 'true',
  BETTER_AUTH_SECRET: 'test-only-better-auth-secret-1234567890',
  AUTH_EMAIL_FROM: 'auth@shopai.test',
  RESEND_API_KEY: 'test-resend-key',
  LOG_LEVEL: 'silent',
});

describe('Better Auth API ve pilot bağlama', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let pilotId: string;
  let verificationUrl: string;

  beforeAll(async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, options: RequestInit) => {
        const body = JSON.parse(String(options.body)) as { text: string };
        verificationUrl = body.text;
        return Response.json({ id: 'test-email' });
      }),
    );
    const created = await database.db.execute(
      sql`INSERT INTO users (email) VALUES (${email}) RETURNING id`,
    );
    pilotId = created.rows[0]?.id as string;
    app = await buildApp(undefined, env);
  });

  afterAll(async () => {
    await app?.close();
    await database.db.execute(
      sql`DELETE FROM sessions WHERE user_id = ${pilotId}::uuid`,
    );
    await database.db.execute(
      sql`DELETE FROM user_identities WHERE user_id = ${pilotId}::uuid`,
    );
    await database.db.execute(
      sql`DELETE FROM auth_audit_events WHERE user_id = ${pilotId}::uuid`,
    );
    await database.db.execute(
      sql`DELETE FROM users WHERE id = ${pilotId}::uuid`,
    );
    await database.db.execute(
      sql`DELETE FROM shopai_auth."user" WHERE email = ${email}`,
    );
    await database.close();
    vi.unstubAllGlobals();
  });

  it('Auth0 yolları kapalıyken pilot girişini korur ve Better Auth bayrağını bildirir', async () => {
    const enabled = await app.inject({
      method: 'GET',
      url: '/v1/auth/capabilities',
    });
    expect(enabled.json()).toEqual({
      betterAuthEnabled: true,
      pilotEnabled: true,
    });
    const disabledApp = await buildApp(undefined, {
      ...env,
      BETTER_AUTH_ENABLED: 'false',
    });
    try {
      const capabilities = await disabledApp.inject({
        method: 'GET',
        url: '/v1/auth/capabilities',
      });
      expect(capabilities.json()).toEqual({
        betterAuthEnabled: false,
        pilotEnabled: true,
      });
      for (const url of [
        '/v1/auth/oidc/start',
        '/v1/auth/oidc/claim',
        '/v1/auth/recover',
        '/v1/auth/better/sign-in/email',
      ]) {
        const response = await disabledApp.inject({ method: 'GET', url });
        expect(response.statusCode, url).toBe(404);
      }
      const pilotLogin = await disabledApp.inject({
        method: 'POST',
        url: '/v1/auth/login',
        headers: { origin },
        payload: { email, token: pilotToken },
      });
      expect(pilotLogin.statusCode).toBe(200);
      expect(pilotLogin.json().user.id).toBe(pilotId);
    } finally {
      await disabledApp.close();
    }
  });

  it('yalnız MFA + pilot kanıtı ile eski UUID için hashli oturum verir', async () => {
    const verificationReturn = `${origin}/login?verification=complete`;
    const signup = await app.inject({
      method: 'POST',
      url: '/v1/auth/better/sign-up/email',
      headers: { origin },
      payload: {
        name: 'Pilot Merchant',
        email,
        password,
        callbackURL: verificationReturn,
      },
    });
    expect(signup.statusCode).toBe(200);
    expect(verificationUrl).toContain('/v1/auth/better/verify-email');
    expect(new URL(verificationUrl).searchParams.get('callbackURL')).toBe(
      verificationReturn,
    );
    const unverifiedSignIn = await app.inject({
      method: 'POST',
      url: '/v1/auth/better/sign-in/email',
      headers: { origin },
      payload: { email, password, callbackURL: verificationReturn },
    });
    expect(unverifiedSignIn.statusCode).toBe(403);
    expect(new URL(verificationUrl).searchParams.get('callbackURL')).toBe(
      verificationReturn,
    );
    const verify = await app.inject({
      method: 'GET',
      url: new URL(verificationUrl).pathname + new URL(verificationUrl).search,
    });
    expect(verify.statusCode).toBe(302);
    expect(verify.headers.location).toBe(verificationReturn);

    const signIn = await app.inject({
      method: 'POST',
      url: '/v1/auth/better/sign-in/email',
      headers: { origin },
      payload: { email, password },
    });
    expect(signIn.statusCode).toBe(200);
    const cookies = signIn.headers['set-cookie'];
    expect(cookies).toBeDefined();
    expect((Array.isArray(cookies) ? cookies : [cookies]).join('; ')).toMatch(
      /Secure/u,
    );
    const baCookie = (Array.isArray(cookies) ? cookies : [cookies])
      .filter(Boolean)
      .map((item) => item!.split(';')[0])
      .join('; ');
    const enable = await app.inject({
      method: 'POST',
      url: '/v1/auth/better/two-factor/enable',
      headers: { origin, cookie: baCookie },
      payload: { method: 'totp', password },
    });
    expect(enable.statusCode).toBe(200);
    const secret = new URL(enable.json().totpURI).searchParams.get('secret');
    expect(secret).toBeTruthy();
    const confirm = await app.inject({
      method: 'POST',
      url: '/v1/auth/better/two-factor/verify-totp',
      headers: { origin, cookie: baCookie },
      payload: { code: testTotp(secret!, -1) },
    });
    expect(confirm.statusCode).toBe(200);
    expect(confirm.json().token).toBeUndefined();

    const base = {
      email,
      password,
      client: 'merchant',
      totp: testTotp(secret!),
    };
    const noOrigin = await app.inject({
      method: 'POST',
      url: '/v1/auth/better/complete',
      payload: base,
    });
    expect(noOrigin.statusCode).toBe(403);
    const wrong = await app.inject({
      method: 'POST',
      url: '/v1/auth/better/complete',
      headers: { origin },
      payload: { ...base, totp: '000000', pilotToken },
    });
    expect(wrong.statusCode).toBe(401);
    const noProof = await app.inject({
      method: 'POST',
      url: '/v1/auth/better/complete',
      headers: { origin },
      payload: base,
    });
    expect(noProof.statusCode).toBe(409);
    const completed = await app.inject({
      method: 'POST',
      url: '/v1/auth/better/complete',
      headers: { origin },
      payload: { ...base, pilotToken },
    });
    expect(completed.statusCode).toBe(200);
    expect(completed.json().user.id).toBe(pilotId);
    const issued = completed.headers['set-cookie'];
    const issuedCookies = Array.isArray(issued) ? issued : [issued];
    const shopaiSession = issuedCookies.find((item) =>
      item?.startsWith('__Host-shopai_session='),
    );
    expect(shopaiSession).toContain('Secure');
    expect(shopaiSession).toContain('HttpOnly');
    expect(shopaiSession).toContain('SameSite=Lax');
    expect(shopaiSession).toContain('Path=/');
    const shopaiCookie = shopaiSession?.split(';')[0];
    expect(shopaiCookie).toBeTruthy();
    const session = await app.inject({
      method: 'GET',
      url: '/v1/auth/session',
      headers: { cookie: shopaiCookie! },
    });
    expect(session.statusCode).toBe(200);
    expect(session.json().user).toMatchObject({
      userId: pilotId,
      authLevel: 'mfa',
    });
    const csrf = session.json().csrfToken as string;
    const missingCsrf = await app.inject({
      method: 'POST',
      url: '/v1/auth/logout-all',
      headers: { origin, cookie: shopaiCookie! },
    });
    expect(missingCsrf.statusCode).toBe(403);
    const wrongOrigin = await app.inject({
      method: 'POST',
      url: '/v1/auth/logout-all',
      headers: {
        origin: 'https://evil.example',
        cookie: shopaiCookie!,
        'x-shopai-csrf': csrf,
      },
    });
    expect(wrongOrigin.statusCode).toBe(403);
    const stored = await database.db.execute(
      sql`SELECT token_hash FROM sessions WHERE user_id = ${pilotId}::uuid AND auth_level = 'mfa'`,
    );
    expect(stored.rows[0]?.token_hash).not.toBe(shopaiCookie!.split('=')[1]);

    const resetRequest = await app.inject({
      method: 'POST',
      url: '/v1/auth/better/request-password-reset',
      headers: { origin },
      payload: { email, redirectTo: `${origin}/login` },
    });
    expect(resetRequest.statusCode).toBe(200);
    expect(verificationUrl).toContain('/v1/auth/better/reset-password/');
    const resetToken = new URL(verificationUrl).pathname.split('/').at(-1);
    expect(resetToken).toBeTruthy();
    const reset = await app.inject({
      method: 'POST',
      url: '/v1/auth/better/reset-password',
      headers: { origin },
      payload: {
        token: resetToken,
        newPassword: 'replacement-test-password-123456',
      },
    });
    expect(reset.statusCode).toBe(200);
    const revoked = await app.inject({
      method: 'GET',
      url: '/v1/auth/session',
      headers: { cookie: shopaiCookie! },
    });
    expect(revoked.statusCode).toBe(401);
  });
});
