import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../apps/api/src/app.js';
import { parseApiEnv } from '../../apps/api/src/env.js';
import { createDatabase } from '../../packages/db/src/client.js';
import { testTotp } from '../helpers/totp.js';
import { fakeConnectorSecretBackend } from '../helpers/fake-connector-secret-backend.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl)
  throw new Error('Better Auth API integration requires PostgreSQL');
const origin = 'https://web.better-auth-test.example';
const apiOrigin = 'https://api.better-auth-test.example';
const email = `ba-pilot-${randomUUID()}@example.invalid`;
const emailB = `ba-merchant-b-${randomUUID()}@example.invalid`;
const password = 'test-only-strong-password-123456';
const pilotToken = 'test-only-pilot-proof-1234567890';
const merchantA = randomUUID();
const merchantB = randomUUID();
const legacyMerchant = randomUUID();
const legacyDiscoveryId = randomUUID();
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
  CONNECTOR_SECRET_BACKEND: 'openbao',
  CONNECTOR_SECRET_OPENBAO_ADDRESS: 'https://openbao.shopai.internal:8200',
  CONNECTOR_SECRET_OPENBAO_MOUNT: 'shopai-staging',
  CONNECTOR_SECRET_OPENBAO_ROLE_ID: 'test-role-id',
  CONNECTOR_SECRET_OPENBAO_SECRET_ID_FILE: '/run/secrets/test-id',
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
  let merchantBUserId: string | undefined;
  let verificationUrl: string;

  async function issueTestSession(
    kind: 'merchant' | 'shopper',
    userId = pilotId,
  ) {
    const raw = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(raw).digest('hex');
    await database.db.execute(sql`
      INSERT INTO sessions
        (user_id, token_hash, expires_at, absolute_expires_at, last_active_at,
         auth_level, authenticated_at, client_kind)
      VALUES
        (${userId}::uuid, ${tokenHash}, now() + interval '12 hours',
         now() + interval '12 hours', now(), 'mfa', now(), ${kind})
    `);
    return `__Host-shopai_session=${raw}`;
  }

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
    app = await buildApp(undefined, env, {
      connectorSecretBackend: fakeConnectorSecretBackend,
    });
  });

  afterAll(async () => {
    await app?.close();
    await database.db.execute(sql`
      DELETE FROM discovery_sessions WHERE id=${legacyDiscoveryId}::uuid
    `);
    await database.db.execute(
      sql`DELETE FROM memberships WHERE merchant_id IN (${merchantA}::uuid, ${merchantB}::uuid, ${legacyMerchant}::uuid)`,
    );
    await database.db.execute(
      sql`DELETE FROM merchants WHERE id IN (${merchantA}::uuid, ${merchantB}::uuid, ${legacyMerchant}::uuid)`,
    );
    await database.db.execute(
      sql`DELETE FROM sessions WHERE user_id = ${pilotId}::uuid`,
    );
    if (merchantBUserId) {
      await database.db.execute(sql`
        DELETE FROM sessions WHERE user_id=${merchantBUserId}::uuid
      `);
      await database.db.execute(sql`
        DELETE FROM users WHERE id=${merchantBUserId}::uuid
      `);
    }
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

  it('eski kimlik yolları kapalıyken pilot girişini korur ve Better Auth bayrağını bildirir', async () => {
    const enabled = await app.inject({
      method: 'GET',
      url: '/v1/auth/capabilities',
    });
    expect(enabled.json()).toEqual({
      betterAuthEnabled: true,
      pilotEnabled: true,
    });
    const disabledApp = await buildApp(
      undefined,
      {
        ...env,
        BETTER_AUTH_ENABLED: 'false',
      },
      { connectorSecretBackend: fakeConnectorSecretBackend },
    );
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
    await database.db.execute(sql`
      INSERT INTO merchants (id, name, slug, active)
      VALUES (${legacyMerchant}::uuid, 'Legacy migration fixture', ${`legacy-${legacyMerchant}`}, true)
    `);
    await database.db.execute(sql`
      INSERT INTO memberships (user_id, merchant_id, role)
      VALUES (${pilotId}::uuid, ${legacyMerchant}::uuid, 'editor')
    `);
    await database.db.execute(sql`
      INSERT INTO discovery_sessions
        (id, surface, transport, merchant_scope, anonymous_user_id, user_id)
      VALUES
        (${legacyDiscoveryId}::uuid, 'web', 'rest', '[]'::jsonb, ${randomUUID()}::uuid, ${pilotId}::uuid)
    `);
    const completed = await app.inject({
      method: 'POST',
      url: '/v1/auth/better/complete',
      headers: { origin },
      payload: { ...base, pilotToken },
    });
    expect(completed.statusCode).toBe(200);
    expect(completed.json().user.id).toBe(pilotId);
    const preserved = await database.db.execute(sql`
      SELECT u.id, u.account_status, m.merchant_id, m.role, d.id AS discovery_id
      FROM users AS u
      JOIN memberships AS m ON m.user_id=u.id
      JOIN discovery_sessions AS d ON d.user_id=u.id
      WHERE u.id=${pilotId}::uuid AND m.merchant_id=${legacyMerchant}::uuid
        AND d.id=${legacyDiscoveryId}::uuid
    `);
    expect(preserved.rows[0]).toMatchObject({
      id: pilotId,
      account_status: 'active',
      merchant_id: legacyMerchant,
      role: 'editor',
      discovery_id: legacyDiscoveryId,
    });
    const oldPilotSessions = await database.db.execute(sql`
      SELECT count(*)::integer AS active FROM sessions
      WHERE user_id=${pilotId}::uuid AND auth_level='pilot' AND revoked_at IS NULL
    `);
    expect(oldPilotSessions.rows[0]?.active).toBe(0);
    await database.db.execute(sql`
      DELETE FROM discovery_sessions WHERE id=${legacyDiscoveryId}::uuid
    `);
    await database.db.execute(sql`
      DELETE FROM memberships WHERE merchant_id=${legacyMerchant}::uuid
    `);
    await database.db.execute(sql`
      DELETE FROM merchants WHERE id=${legacyMerchant}::uuid
    `);
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

    const remoteBrowser = await issueTestSession('merchant');
    const remoteBeforeReset = await app.inject({
      method: 'GET',
      url: '/v1/auth/session',
      headers: { cookie: remoteBrowser },
    });
    expect(remoteBeforeReset.statusCode).toBe(200);

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
    const resetLink = new URL(verificationUrl);
    const resetCallback = await app.inject({
      method: 'GET',
      url: `${resetLink.pathname}${resetLink.search}`,
    });
    expect(resetCallback.statusCode).toBe(302);
    const redirect = new URL(resetCallback.headers.location as string);
    expect(redirect.origin).toBe(origin);
    expect(redirect.pathname).toBe('/login');
    expect(redirect.searchParams.get('token')).toBe(resetToken);
    const disallowedResetPost = await app.inject({
      method: 'POST',
      url: `${resetLink.pathname}${resetLink.search}`,
      headers: { origin },
    });
    expect(disallowedResetPost.statusCode).toBe(404);
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
    const remoteAfterReset = await app.inject({
      method: 'GET',
      url: '/v1/auth/session',
      headers: { cookie: remoteBrowser },
    });
    expect(remoteAfterReset.statusCode).toBe(401);
  });

  it('merchant A/B ve shopper yetkilerini ayırır; tüm oturumları sunucuda iptal eder', async () => {
    await database.db.execute(sql`
      INSERT INTO merchants (id, name, slug, active)
      VALUES
        (${merchantA}::uuid, 'Auth test A', ${`auth-a-${merchantA}`}, true),
        (${merchantB}::uuid, 'Auth test B', ${`auth-b-${merchantB}`}, true)
    `);
    await database.db.execute(sql`
      INSERT INTO memberships (user_id, merchant_id, role)
      VALUES (${pilotId}::uuid, ${merchantA}::uuid, 'owner')
    `);
    const secondUser = await database.db.execute(sql`
      INSERT INTO users (email, account_status, email_verified_at)
      VALUES (${emailB}, 'active', now()) RETURNING id
    `);
    merchantBUserId = secondUser.rows[0]?.id as string;
    await database.db.execute(sql`
      INSERT INTO memberships (user_id, merchant_id, role)
      VALUES (${merchantBUserId}::uuid, ${merchantB}::uuid, 'owner')
    `);

    const firstBrowser = await issueTestSession('merchant');
    const secondUserBrowser = await issueTestSession(
      'merchant',
      merchantBUserId,
    );
    const secondBrowser = await issueTestSession('merchant');
    const shopperBrowser = await issueTestSession('shopper');
    const firstSession = await app.inject({
      method: 'GET',
      url: '/v1/auth/session',
      headers: { cookie: firstBrowser },
    });
    expect(firstSession.statusCode).toBe(200);
    const csrf = firstSession.json().csrfToken as string;
    const memberList = await app.inject({
      method: 'GET',
      url: '/v1/merchants',
      headers: { cookie: firstBrowser },
    });
    expect(memberList.statusCode).toBe(200);
    expect(memberList.json().merchants).toEqual([
      expect.objectContaining({ id: merchantA, role: 'owner' }),
    ]);
    const ownStore = await app.inject({
      method: 'GET',
      url: `/v1/merchants/${merchantA}`,
      headers: { cookie: firstBrowser },
    });
    expect(ownStore.statusCode).toBe(200);
    const otherStore = await app.inject({
      method: 'GET',
      url: `/v1/merchants/${merchantB}`,
      headers: { cookie: firstBrowser },
    });
    expect(otherStore.statusCode).toBe(403);
    const otherStoreMutation = await app.inject({
      method: 'POST',
      url: `/v1/merchants/${merchantB}/connections`,
      headers: { origin, cookie: firstBrowser, 'x-shopai-csrf': csrf },
      payload: { provider: 'csv' },
    });
    expect(otherStoreMutation.statusCode).toBe(403);
    const secondUserList = await app.inject({
      method: 'GET',
      url: '/v1/merchants',
      headers: { cookie: secondUserBrowser },
    });
    expect(secondUserList.statusCode).toBe(200);
    expect(secondUserList.json().merchants).toEqual([
      expect.objectContaining({ id: merchantB, role: 'owner' }),
    ]);
    const secondUserOwnStore = await app.inject({
      method: 'GET',
      url: `/v1/merchants/${merchantB}`,
      headers: { cookie: secondUserBrowser },
    });
    expect(secondUserOwnStore.statusCode).toBe(200);
    const secondUserOtherStore = await app.inject({
      method: 'GET',
      url: `/v1/merchants/${merchantA}`,
      headers: { cookie: secondUserBrowser },
    });
    expect(secondUserOtherStore.statusCode).toBe(403);

    const shopperList = await app.inject({
      method: 'GET',
      url: '/v1/merchants',
      headers: { cookie: shopperBrowser },
    });
    expect(shopperList.statusCode).toBe(403);
    const shopperOwnStore = await app.inject({
      method: 'GET',
      url: `/v1/merchants/${merchantA}`,
      headers: { cookie: shopperBrowser },
    });
    expect(shopperOwnStore.statusCode).toBe(403);

    const logoutAll = await app.inject({
      method: 'POST',
      url: '/v1/auth/logout-all',
      headers: { origin, cookie: firstBrowser, 'x-shopai-csrf': csrf },
    });
    expect(logoutAll.statusCode).toBe(200);
    for (const cookie of [firstBrowser, secondBrowser, shopperBrowser]) {
      const revoked = await app.inject({
        method: 'GET',
        url: '/v1/auth/session',
        headers: { cookie },
      });
      expect(revoked.statusCode).toBe(401);
    }
    const isolatedOtherUser = await app.inject({
      method: 'GET',
      url: '/v1/auth/session',
      headers: { cookie: secondUserBrowser },
    });
    expect(isolatedOtherUser.statusCode).toBe(200);
  });

  it('son owner kapatmayı reddeder; uygun hesapta tüm oturumları ve yeniden girişi engeller', async () => {
    const firstBrowser = await issueTestSession('merchant');
    const secondBrowser = await issueTestSession('shopper');
    const current = await app.inject({
      method: 'GET',
      url: '/v1/auth/session',
      headers: { cookie: firstBrowser },
    });
    expect(current.statusCode).toBe(200);
    const headers = {
      origin,
      cookie: firstBrowser,
      'x-shopai-csrf': current.json().csrfToken as string,
    };
    const lastOwner = await app.inject({
      method: 'POST',
      url: '/v1/auth/account/close',
      headers,
    });
    expect(lastOwner.statusCode, JSON.stringify(lastOwner.json())).toBe(409);
    expect(lastOwner.json()).toEqual({ code: 'OWNER_TRANSFER_REQUIRED' });
    const stillOpen = await app.inject({
      method: 'GET',
      url: '/v1/auth/session',
      headers: { cookie: secondBrowser },
    });
    expect(stillOpen.statusCode).toBe(200);
    const credentialBefore = await database.db.execute(sql`
      SELECT u.id, a.id AS account_id FROM shopai_auth."user" AS u
      JOIN shopai_auth."account" AS a ON a."userId"=u.id
      JOIN user_identities AS i ON i.subject=u.id
      WHERE i.user_id=${pilotId}::uuid AND i.issuer='better-auth'
    `);
    expect(credentialBefore.rows).toHaveLength(1);
    await database.db.execute(sql`
      INSERT INTO shopai_auth."session"
        ("id", "expiresAt", "token", "createdAt", "updatedAt", "userId")
      VALUES
        (${randomUUID()}, now() + interval '1 hour', ${randomUUID()}, now(), now(), ${credentialBefore.rows[0]?.id})
    `);
    const liveBetterBefore = await database.db.execute(sql`
      SELECT count(*)::integer AS count FROM shopai_auth."session" AS s
      JOIN user_identities AS i ON i.subject=s."userId"
      WHERE i.user_id=${pilotId}::uuid AND s."expiresAt">now()
    `);
    expect(Number(liveBetterBefore.rows[0]?.count)).toBeGreaterThan(0);

    await database.db.execute(sql`
      DELETE FROM memberships
      WHERE user_id=${pilotId}::uuid AND merchant_id=${merchantA}::uuid
    `);
    const closed = await app.inject({
      method: 'POST',
      url: '/v1/auth/account/close',
      headers,
    });
    expect(closed.statusCode).toBe(200);
    for (const cookie of [firstBrowser, secondBrowser]) {
      const revoked = await app.inject({
        method: 'GET',
        url: '/v1/auth/session',
        headers: { cookie },
      });
      expect(revoked.statusCode).toBe(401);
    }
    const account = await database.db.execute(sql`
      SELECT account_status, closed_at FROM users WHERE id=${pilotId}::uuid
    `);
    expect(account.rows[0]).toMatchObject({ account_status: 'closed' });
    expect(account.rows[0]?.closed_at).not.toBeNull();
    const credentialAfter = await database.db.execute(sql`
      SELECT u.id, a.id AS account_id FROM shopai_auth."user" AS u
      JOIN shopai_auth."account" AS a ON a."userId"=u.id
      JOIN user_identities AS i ON i.subject=u.id
      WHERE i.user_id=${pilotId}::uuid AND i.issuer='better-auth'
    `);
    expect(credentialAfter.rows).toEqual(credentialBefore.rows);
    const signIn = await app.inject({
      method: 'POST',
      url: '/v1/auth/better/sign-in/email',
      headers: { origin },
      payload: { email, password: 'replacement-test-password-123456' },
    });
    expect(signIn.statusCode).toBe(401);
    const activeBetterSessions = await database.db.execute(sql`
      SELECT count(*)::integer AS count FROM shopai_auth."session" AS s
      JOIN user_identities AS i ON i.subject=s."userId"
      WHERE i.user_id=${pilotId}::uuid AND s."expiresAt">now()
    `);
    expect(activeBetterSessions.rows[0]?.count).toBe(0);
  });
});
