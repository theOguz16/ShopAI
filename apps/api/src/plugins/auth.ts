import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import type { Database } from '@shopai/db';
import {
  memberships,
  merchants,
  sessions,
  setTenantContext,
  users,
} from '@shopai/db';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { type Auth0ClientKind, parseAuth0Config } from '../auth0-oidc.js';
import { registerAuth0Routes } from '../auth0-routes.js';
import type { ApiEnv } from '../env.js';

export type Role = 'owner' | 'editor' | 'viewer';
export type AuthContext = {
  userId: string;
  email: string;
  authLevel?: 'pilot' | 'password' | 'mfa';
  authenticatedAt?: Date | null;
  sessionId?: string;
  clientKind?: 'pilot' | Auth0ClientKind;
};
export type AuthenticatedMerchant = {
  id: string;
  name: string;
  slug: string;
  role: Role;
};
declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext | null;
  }
}

const legacyCookie = 'shopai_session';
const oauthCookie = (env: ApiEnv) =>
  env.DEPLOY_ENV === 'local' || env.DEPLOY_ENV === 'test'
    ? 'shopai_oidc_session'
    : '__Host-shopai_session';
const cookieAttributes = (env: ApiEnv) =>
  `Path=/; HttpOnly; SameSite=Lax${env.DEPLOY_ENV === 'staging' || env.DEPLOY_ENV === 'production' ? '; Secure' : ''}`;
const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex');
function cookie(request: FastifyRequest, name: string): string | undefined {
  const matches = request.headers.cookie
    ?.split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`));
  return matches?.length === 1 ? matches[0]?.slice(name.length + 1) : undefined;
}
const validSessionToken = (token: string | undefined): token is string =>
  typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/u.test(token);
const safeEqual = (a: string, b: string) =>
  timingSafeEqual(Buffer.from(hash(a), 'hex'), Buffer.from(hash(b), 'hex'));

export interface AuthApi {
  db: Database | undefined;
  allowedOrigins: ReadonlySet<string>;
  oidcEnabled: boolean;
  pilotEnabled: boolean;
  login(email: string, token: string, reply: FastifyReply): Promise<unknown>;
  authenticate(request: FastifyRequest): Promise<AuthContext | null>;
  logout(request: FastifyRequest, reply: FastifyReply): Promise<{ ok: true }>;
  logoutAll(request: FastifyRequest, reply: FastifyReply): Promise<unknown>;
  issueOidcSession(
    userId: string,
    kind: Auth0ClientKind,
    level: 'password' | 'mfa',
    authenticatedAt: Date | null,
    reply: FastifyReply,
  ): Promise<void>;
  csrfToken(request: FastifyRequest): string | null;
  verifyPilotCredential(email: string, token: string): boolean;
  membership(
    request: FastifyRequest,
    merchantId: string,
  ): Promise<Role | undefined>;
  listMerchants(request: FastifyRequest): Promise<AuthenticatedMerchant[]>;
}

export function registerAuth(
  app: FastifyInstance,
  db: Database | undefined,
  env: ApiEnv,
  oidcEnabled = false,
  pilotEnabled = true,
) {
  const auth0Config = parseAuth0Config(process.env);
  oidcEnabled = Boolean(auth0Config);
  pilotEnabled = env.AUTH_PILOT_LOGIN_ENABLED !== 'false';
  if (
    auth0Config &&
    (!db ||
      !env.MCP_ALLOWED_ORIGINS.includes(auth0Config.webOrigin) ||
      Object.values(auth0Config.clients).some(
        (client) =>
          new URL(client.redirectUri).origin !== env.MCP_PUBLIC_ORIGIN,
      ))
  )
    throw new Error(
      'Auth0 origins or PostgreSQL are not configured for this API',
    );
  app.decorateRequest('auth', null);
  const requireDb = () => {
    if (!db)
      throw Object.assign(
        new Error('Kimlik servisi postgres modunda kullanılabilir.'),
        { statusCode: 503 },
      );
    return db;
  };
  const clearCookies = (reply: FastifyReply, oidcSession: boolean) => {
    const secure =
      env.DEPLOY_ENV === 'staging' || env.DEPLOY_ENV === 'production';
    const pilotExpiry = `${legacyCookie}=; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}; Max-Age=0; Path=/`;
    const oauthExpiry = `${oauthCookie(env)}=; ${cookieAttributes(env)}; Max-Age=0`;
    reply.header(
      'Set-Cookie',
      oidcSession ? [pilotExpiry, oauthExpiry] : pilotExpiry,
    );
  };
  const authApi: AuthApi = {
    db,
    allowedOrigins: new Set(env.MCP_ALLOWED_ORIGINS),
    oidcEnabled,
    pilotEnabled,
    verifyPilotCredential(email: string, token: string) {
      const configured = env.AUTH_PILOT_CREDENTIALS[email.trim().toLowerCase()];
      return (
        safeEqual(configured ?? 'invalid-credential-placeholder', token) &&
        Boolean(configured)
      );
    },
    async login(email: string, token: string, reply: FastifyReply) {
      if (!pilotEnabled)
        return reply.code(410).send({ code: 'PILOT_LOGIN_DISABLED' });
      const database = requireDb();
      const normalized = email.trim().toLowerCase();
      if (!authApi.verifyPilotCredential(normalized, token))
        return reply.code(401).send({ code: 'INVALID_CREDENTIALS' });
      // Do not reactivate, overwrite or create a pilot login for an OIDC-linked user.
      const existing = await database.execute(
        sql`SELECT id, account_status FROM users WHERE email = ${normalized}`,
      );
      if (existing.rows.length && existing.rows[0]?.account_status !== 'pilot')
        return reply.code(403).send({ code: 'PILOT_ACCOUNT_MIGRATED' });
      const [user] = await database
        .insert(users)
        .values({ email: normalized })
        .onConflictDoNothing({ target: users.email })
        .returning();
      const id = user?.id ?? existing.rows[0]?.id;
      if (typeof id !== 'string')
        return reply.code(409).send({ code: 'PILOT_LOGIN_CONFLICT' });
      const raw = randomBytes(32).toString('base64url');
      await database.insert(sessions).values({
        userId: id,
        tokenHash: hash(raw),
        expiresAt: new Date(Date.now() + env.SESSION_TTL_HOURS * 3600000),
      });
      reply.header(
        'Set-Cookie',
        `${legacyCookie}=${raw}; ${cookieAttributes(env)}; Max-Age=${env.SESSION_TTL_HOURS * 3600}`,
      );
      return { user: { id, email: normalized } };
    },
    async authenticate(request: FastifyRequest) {
      if (!db) return null;
      const oidc = cookie(request, oauthCookie(env));
      const pilot = cookie(request, legacyCookie);
      const raw = oidc ?? (pilotEnabled ? pilot : undefined);
      if (!validSessionToken(raw)) return null;
      const oauth = Boolean(oidc);
      const now = new Date();
      const result = await db.execute(sql`
        UPDATE sessions AS s SET last_active_at = ${now}
        FROM users AS u
        WHERE s.user_id = u.id AND s.token_hash = ${hash(raw)}
          AND s.revoked_at IS NULL AND s.expires_at > ${now}
          AND COALESCE(s.absolute_expires_at, s.expires_at) > ${now}
          AND (
            (s.auth_level = 'pilot' AND u.account_status = 'pilot' AND ${!oauth} AND ${pilotEnabled})
            OR
            (s.auth_level IN ('password','mfa') AND u.account_status = 'active'
             AND u.email_verified_at IS NOT NULL AND ${oauth}
             AND s.last_active_at > ${new Date(now.getTime() - 30 * 60000)}
             AND (s.client_kind <> 'merchant' OR s.last_active_at > ${new Date(now.getTime() - 15 * 60000)}))
          )
        RETURNING s.id, u.id AS user_id, u.email, s.auth_level, s.authenticated_at, s.client_kind
      `);
      const row = result.rows[0];
      if (
        !row ||
        typeof row.user_id !== 'string' ||
        typeof row.email !== 'string'
      )
        return null;
      return {
        userId: row.user_id,
        email: row.email,
        authLevel: row.auth_level as AuthContext['authLevel'],
        authenticatedAt:
          row.authenticated_at instanceof Date ? row.authenticated_at : null,
        sessionId: row.id as string,
        clientKind: row.client_kind as AuthContext['clientKind'],
      };
    },
    async issueOidcSession(userId, kind, level, authenticatedAt, reply) {
      const database = requireDb();
      const raw = randomBytes(32).toString('base64url');
      const expiry = new Date(Date.now() + 12 * 3600000);
      await database.execute(sql`
        INSERT INTO sessions (user_id, token_hash, expires_at, absolute_expires_at, last_active_at, auth_level, authenticated_at, client_kind)
        VALUES (${userId}::uuid, ${hash(raw)}, ${expiry}, ${expiry}, now(), ${level}, ${authenticatedAt}, ${kind})
      `);
      const prior = reply.getHeader('Set-Cookie');
      reply.header('Set-Cookie', [
        ...(Array.isArray(prior) ? prior : prior ? [String(prior)] : []),
        `${oauthCookie(env)}=${raw}; ${cookieAttributes(env)}; Max-Age=${12 * 3600}`,
      ]);
    },
    csrfToken(request) {
      const raw = cookie(request, oauthCookie(env));
      return request.auth?.authLevel !== 'pilot' && validSessionToken(raw)
        ? createHmac('sha256', env.REDIRECT_SIGNING_SECRET)
            .update(raw)
            .digest('base64url')
        : null;
    },
    async logout(request, reply) {
      const raw =
        cookie(request, oauthCookie(env)) ?? cookie(request, legacyCookie);
      if (validSessionToken(raw) && db)
        await db.execute(
          sql`UPDATE sessions SET revoked_at = now() WHERE token_hash = ${hash(raw)} AND revoked_at IS NULL`,
        );
      clearCookies(reply, Boolean(cookie(request, oauthCookie(env))));
      return { ok: true };
    },
    async logoutAll(request, reply) {
      if (!request.auth)
        return reply.code(401).send({ code: 'UNAUTHENTICATED' });
      await requireDb().execute(
        sql`UPDATE sessions SET revoked_at = now() WHERE user_id = ${request.auth.userId}::uuid AND revoked_at IS NULL`,
      );
      clearCookies(reply, Boolean(cookie(request, oauthCookie(env))));
      return { ok: true };
    },
    async membership(request, merchantId) {
      if (!request.auth || request.auth.clientKind === 'shopper' || !db)
        return undefined;
      return db.transaction(async (tx) => {
        await setTenantContext(tx, merchantId);
        const [membership] = await tx
          .select({ role: memberships.role })
          .from(memberships)
          .where(
            and(
              eq(memberships.userId, request.auth!.userId),
              eq(memberships.merchantId, merchantId),
            ),
          );
        return membership?.role as Role | undefined;
      });
    },
    async listMerchants(request) {
      if (!request.auth || request.auth.clientKind === 'shopper' || !db)
        return [];
      const rows = await db
        .select({
          id: merchants.id,
          name: merchants.name,
          slug: merchants.slug,
          role: memberships.role,
        })
        .from(memberships)
        .innerJoin(merchants, eq(merchants.id, memberships.merchantId))
        .where(eq(memberships.userId, request.auth.userId))
        .orderBy(asc(merchants.name), asc(merchants.id));
      return rows.map((row) => ({ ...row, role: row.role as Role }));
    },
  };
  app.decorate('authApi', authApi);
  app.addHook('preHandler', async (request, reply) => {
    request.auth = await app.authApi.authenticate(request);
    // A verified Origin + an unforgeable session-bound CSRF header are both
    // required for OIDC cookie mutations. Existing pilot sessions remain on
    // their old contract until an explicit operator-controlled cutover.
    if (
      !request.auth ||
      request.auth.authLevel === 'pilot' ||
      !['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)
    )
      return;
    // Public endpoints do not use authenticated account state; they remain
    // callable with or without an ambient browser cookie.
    const path = request.url.split('?')[0];
    if (
      path === '/mcp' ||
      path === '/v1/search' ||
      path === '/discovery-session' ||
      path === '/v1/interaction-events' ||
      path?.match(/^\/v1\/stores\/[^/]+\/search$/u)
    )
      return;
    const origin = request.headers.origin;
    const expected = authApi.csrfToken(request);
    if (
      !origin ||
      !authApi.allowedOrigins.has(origin) ||
      !expected ||
      typeof request.headers['x-shopai-csrf'] !== 'string' ||
      !safeEqual(request.headers['x-shopai-csrf'], expected)
    )
      return void reply.code(403).send({ code: 'CSRF_REJECTED' });
  });
  registerAuth0Routes(app, db, env, auth0Config);
}

declare module 'fastify' {
  interface FastifyInstance {
    authApi: AuthApi;
  }
}

export const requireRole =
  (...allowed: Role[]) =>
  async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const merchantId = (request.params as { merchantId?: string }).merchantId;
    const role = merchantId
      ? await request.server.authApi.membership(request, merchantId)
      : undefined;
    if (!request.auth)
      return void reply.code(401).send({ code: 'UNAUTHENTICATED' });
    if (request.auth.clientKind === 'shopper')
      return void reply.code(403).send({ code: 'FORBIDDEN' });
    if (!role || !allowed.includes(role))
      return void reply.code(403).send({ code: 'FORBIDDEN' });
    if (
      role === 'owner' &&
      request.auth.authLevel !== 'pilot' &&
      request.auth.authLevel !== 'mfa'
    )
      return void reply.code(403).send({ code: 'MFA_REQUIRED' });
  };

export const requireRecentMfa = async (
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> => {
  const auth = request.auth;
  if (
    !auth ||
    auth.authLevel !== 'mfa' ||
    !auth.authenticatedAt ||
    Date.now() - auth.authenticatedAt.getTime() > 5 * 60000
  )
    return void reply.code(403).send({ code: 'MFA_STEP_UP_REQUIRED' });
};

export const requireSameOrigin = async (
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> => {
  const origin = request.headers.origin;
  if (origin && !request.server.authApi.allowedOrigins.has(origin))
    return void reply.code(403).send({ code: 'FORBIDDEN_ORIGIN' });
};
