import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../apps/api/src/app.js';
import { parseApiEnv } from '../../apps/api/src/env.js';
import { createDatabase } from '../../packages/db/src/client.js';
import { userIdentities, users } from '../../packages/db/src/index.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('Auth0 flows require PostgreSQL');
const origin = 'https://web.auth0-test.example';
const issuer = 'https://auth.auth0-test.example/';
const email = `auth0-pilot-${randomUUID()}@example.invalid`;
const token = 'integration-pilot-code-do-not-use-outside-ci';
const key = Buffer.alloc(32, 7).toString('base64');
const stubVariables = {
  AUTH0_ENABLED: 'true',
  AUTH0_ISSUER: issuer,
  AUTH0_WEB_ORIGIN: origin,
  AUTH0_TRANSACTION_KEY: key,
  AUTH0_SHOPPER_CLIENT_ID: 'test-shopper-client',
  AUTH0_SHOPPER_CLIENT_SECRET: 'test-only-shopper-secret-1234567890-1234567890',
  AUTH0_SHOPPER_REDIRECT_URI:
    'https://api.auth0-test.example/v1/auth/oidc/callback/shopper',
  AUTH0_MERCHANT_CLIENT_ID: 'test-merchant-client',
  AUTH0_MERCHANT_CLIENT_SECRET:
    'test-only-merchant-secret-1234567890-1234567890',
  AUTH0_MERCHANT_REDIRECT_URI:
    'https://api.auth0-test.example/v1/auth/oidc/callback/merchant',
  AUTH0_DATABASE_CONNECTION: 'test-database',
} as const;

// This mock checks ShopAI's business and session handling, not the underlying
// openid-client signature checks. A real Auth0/HTTPS test remains mandatory.
// Business integration fixture: simulate the *output* of an already verified
// provider, not token signatures, discovery or nonce verification. Those require
// separate cryptographic tests and an actual Auth0/HTTPS staging acceptance.
vi.mock('../../apps/api/src/auth0-client-library.js', () => ({
  verifyAuth0Grant: async (
    _configuration: unknown,
    _kind: unknown,
    code: string,
  ) => {
    if (code === 'unverified') throw new Error('OIDC_EMAIL_UNVERIFIED');
    if (code === 'wrong-audience') throw new Error('OIDC_WRONG_AUDIENCE');
    return {
      issuer,
      subject: 'auth0|verified-fixture',
      email,
      emailVerified: true,
      mfa: true,
      authenticatedAt: new Date(),
    };
  },
}));

describe('Ürün-003 OIDC account and session integration (mock provider)', () => {
  const database = createDatabase(databaseUrl!);
  const env = parseApiEnv({
    CATALOG_MODE: 'postgres',
    DATABASE_URL: databaseUrl,
    DEPLOY_ENV: 'test',
    RELEASE_VERSION: 'test-auth0',
    MCP_PUBLIC_ORIGIN: 'https://api.auth0-test.example',
    MCP_ALLOWED_ORIGINS: `${origin},https://chatgpt.com`,
    WIDGET_ORIGIN: 'https://widget.auth0-test.example',
    REDIRECT_SIGNING_SECRET:
      'test-only-auth0-redirect-signing-secret-1234567890',
    AUTH_PILOT_CREDENTIALS: JSON.stringify({ [email]: token }),
    AUTH_PILOT_LOGIN_ENABLED: 'true',
    LOG_LEVEL: 'silent',
  });
  let app: Awaited<ReturnType<typeof buildApp>>;
  let pilotId: string;
  beforeEach(async () => {
    for (const [name, value] of Object.entries(stubVariables))
      vi.stubEnv(name, value);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (resource: URL) => {
        const url = String(resource);
        if (url.includes('openid-configuration'))
          return Response.json({
            issuer,
            authorization_endpoint: `${issuer}authorize`,
            token_endpoint: `${issuer}oauth/token`,
            jwks_uri: `${issuer}.well-known/jwks.json`,
          });
        return Response.json({});
      }),
    );
    app = await buildApp(undefined, env);
    const [pilot] = await database.db
      .insert(users)
      .values({ email })
      .onConflictDoNothing({ target: users.email })
      .returning();
    if (!pilot) throw new Error('pilot setup failed');
    pilotId = pilot.id;
  });
  afterEach(async () => {
    await app?.close();
    await database.db.execute(
      sql`DELETE FROM oidc_auth_transactions WHERE claim_user_id=${pilotId}::uuid OR stepup_user_id=${pilotId}::uuid`,
    );
    await database.db
      .delete(userIdentities)
      .where(eq(userIdentities.userId, pilotId));
    await database.db.execute(
      sql`DELETE FROM sessions WHERE user_id=${pilotId}::uuid`,
    );
    await database.db.execute(
      sql`DELETE FROM auth_audit_events WHERE user_id=${pilotId}::uuid`,
    );
    await database.db.delete(users).where(eq(users.id, pilotId));
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  async function claim() {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/oidc/claim',
      headers: { origin },
      payload: {
        client: 'merchant',
        returnTo: '/dashboard',
        pilotEmail: email,
        pilotToken: token,
      },
    });
    expect(response.statusCode).toBe(200);
    const redirect = new URL(response.json().authorizationUrl);
    expect(redirect.searchParams.get('code_challenge_method')).toBe('S256');
    expect(redirect.searchParams.get('nonce')).toBeTruthy();
    const cookies = response.headers['set-cookie'];
    const binding = Array.isArray(cookies) ? cookies[0] : cookies;
    expect(binding).toContain('shopai_oidc_state=');
    return {
      state: redirect.searchParams.get('state')!,
      cookie: binding!.split(';')[0]!,
    };
  }
  it('denies wrong pilot proof and an unverified callback without linking or replay', async () => {
    const wrong = await app.inject({
      method: 'POST',
      url: '/v1/auth/oidc/claim',
      headers: { origin },
      payload: {
        client: 'merchant',
        pilotEmail: email,
        pilotToken: 'wrong-pilot-proof-long-enough',
      },
    });
    expect(wrong.statusCode).toBe(401);
    const { state, cookie } = await claim();
    const wrongBrowser = await app.inject({
      method: 'GET',
      url: `/v1/auth/oidc/callback/merchant?state=${state}&code=unverified`,
    });
    expect(wrongBrowser.statusCode).toBe(401);
    const response = await app.inject({
      method: 'GET',
      url: `/v1/auth/oidc/callback/merchant?state=${state}&code=unverified`,
      headers: { cookie },
    });
    expect(response.statusCode).toBe(401);
    const replay = await app.inject({
      method: 'GET',
      url: `/v1/auth/oidc/callback/merchant?state=${state}&code=verified`,
      headers: { cookie },
    });
    expect(replay.statusCode).toBe(401);
    const identities = await database.db
      .select()
      .from(userIdentities)
      .where(eq(userIdentities.userId, pilotId));
    expect(identities).toHaveLength(0);
  });
  it('binds proven pilot account to issuer + subject, keeps UUID, revokes pilot sessions', async () => {
    const legacy = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers: { origin },
      payload: { email, token },
    });
    expect(legacy.statusCode).toBe(200);
    const legacyCookie = String(legacy.headers['set-cookie']).split(';')[0];
    const { state, cookie } = await claim();
    const callback = await app.inject({
      method: 'GET',
      url: `/v1/auth/oidc/callback/merchant?state=${state}&code=verified`,
      headers: { cookie },
    });
    expect(callback.statusCode).toBe(303);
    const [linked] = await database.db
      .select()
      .from(userIdentities)
      .where(eq(userIdentities.userId, pilotId));
    expect(linked).toMatchObject({
      userId: pilotId,
      issuer,
      subject: 'auth0|verified-fixture',
    });
    const [row] = await database.db
      .select()
      .from(users)
      .where(eq(users.id, pilotId));
    expect(row?.id).toBe(pilotId);
    const stale = await app.inject({
      method: 'GET',
      url: '/v1/auth/session',
      headers: { cookie: legacyCookie },
    });
    expect(stale.statusCode).toBe(401);
    const issued = callback.headers['set-cookie'];
    const cookies = Array.isArray(issued) ? issued : [issued];
    const oidcCookie = cookies
      .find((item) => item?.startsWith('shopai_oidc_session='))
      ?.split(';')[0];
    expect(oidcCookie).toBeTruthy();
    const active = await app.inject({
      method: 'GET',
      url: '/v1/auth/session',
      headers: { cookie: oidcCookie! },
    });
    expect(active.statusCode).toBe(200);
    expect(active.json().user.userId).toBe(pilotId);
    expect(active.json().user.authLevel).toBe('mfa');
    const csrf = active.json().csrfToken;
    expect(csrf).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    // The same verified user may also have a shopper session. That browser
    // session must not inherit merchant authority from the user's membership.
    const shopperRaw = randomBytes(32).toString('base64url');
    const shopperHash = createHash('sha256').update(shopperRaw).digest('hex');
    await database.db.execute(sql`
      INSERT INTO sessions (user_id, token_hash, expires_at, absolute_expires_at,
        last_active_at, auth_level, authenticated_at, client_kind)
      VALUES (${pilotId}::uuid, ${shopperHash}, now() + interval '12 hours',
        now() + interval '12 hours', now(), 'mfa', now(), 'shopper')
    `);
    const shopperCookie = `shopai_oidc_session=${shopperRaw}`;
    const shopperSession = await app.inject({
      method: 'GET',
      url: '/v1/auth/session',
      headers: { cookie: shopperCookie },
    });
    expect(shopperSession.statusCode).toBe(200);
    expect(shopperSession.json().user.clientKind).toBe('shopper');
    const shopperCsrf = shopperSession.json().csrfToken;
    const shopperMerchants = await app.inject({
      method: 'GET',
      url: '/v1/merchants',
      headers: { cookie: shopperCookie },
    });
    expect(shopperMerchants.statusCode).toBe(403);
    const shopperSetup = await app.inject({
      method: 'POST',
      url: '/v1/setup/merchant',
      headers: {
        cookie: shopperCookie,
        origin,
        'x-shopai-csrf': shopperCsrf,
      },
      payload: { name: 'Unauthorized shopper merchant' },
    });
    expect(shopperSetup.statusCode).toBe(403);
    const shopperMerchantDetail = await app.inject({
      method: 'GET',
      url: `/v1/merchants/${randomUUID()}`,
      headers: { cookie: shopperCookie },
    });
    expect(shopperMerchantDetail.statusCode).toBe(403);
    const missingCsrf = await app.inject({
      method: 'POST',
      url: '/v1/auth/logout-all',
      headers: { cookie: oidcCookie!, origin },
    });
    expect(missingCsrf.statusCode).toBe(403);
    const revoked = await app.inject({
      method: 'POST',
      url: '/v1/auth/logout-all',
      headers: { cookie: oidcCookie!, origin, 'x-shopai-csrf': csrf },
    });
    expect(revoked.statusCode).toBe(200);
    const noLongerActive = await app.inject({
      method: 'GET',
      url: '/v1/auth/session',
      headers: { cookie: oidcCookie! },
    });
    expect(noLongerActive.statusCode).toBe(401);
    const oldPilotLogin = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers: { origin },
      payload: { email, token },
    });
    expect(oldPilotLogin.statusCode).toBe(403);
  });
});
