import { createBetterAuth } from '@shopai/auth';
import type { Database } from '@shopai/db';
import { sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { createAuthEmailSender } from './auth-email.js';
import type { ApiEnv } from './env.js';

const completeSchema = z
  .object({
    email: z.string().trim().email().max(254),
    password: z.string().min(8).max(1024),
    totp: z
      .string()
      .regex(/^\d{6}$/u)
      .optional(),
    backupCode: z.string().min(8).max(128).optional(),
    client: z.enum(['merchant', 'shopper']),
    pilotToken: z.string().min(16).max(256).optional(),
  })
  .strict()
  .refine((input) => Boolean(input.totp) !== Boolean(input.backupCode));

const allowedAuthPaths = new Set([
  'sign-up/email',
  'sign-in/email',
  'sign-out',
  'get-session',
  'verify-email',
  'send-verification-email',
  'request-password-reset',
  'reset-password',
  'two-factor/enable',
  'two-factor/verify-totp',
]);

function incomingHeaders(request: FastifyRequest): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (typeof value === 'string') headers.set(key, value);
    else if (Array.isArray(value))
      for (const item of value) headers.append(key, item);
  }
  return headers;
}

function withoutBearerTokens(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutBearerTokens);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key]) =>
          !['token', 'accessToken', 'refreshToken', 'idToken'].includes(key),
      )
      .map(([key, item]) => [key, withoutBearerTokens(item)]),
  );
}

export function registerBetterAuthRoutes(
  app: FastifyInstance,
  db: Database | undefined,
  env: ApiEnv,
) {
  if (env.BETTER_AUTH_ENABLED !== 'true') return;
  if (
    !db ||
    env.CATALOG_MODE !== 'postgres' ||
    !env.BETTER_AUTH_SECRET ||
    !env.RESEND_API_KEY ||
    !env.AUTH_EMAIL_FROM
  )
    throw new Error('Better Auth requires PostgreSQL and email delivery');
  const auth = createBetterAuth({
    databaseUrl: env.DATABASE_URL,
    baseUrl: env.MCP_PUBLIC_ORIGIN,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: env.MCP_ALLOWED_ORIGINS,
    sendEmail: createAuthEmailSender({
      apiKey: env.RESEND_API_KEY,
      from: env.AUTH_EMAIL_FROM,
      apiOrigin: env.MCP_PUBLIC_ORIGIN,
    }),
    onPasswordReset: async (betterUserId) => {
      await db.execute(sql`
        UPDATE sessions SET revoked_at = now()
        WHERE user_id IN (
          SELECT user_id FROM user_identities
          WHERE issuer = 'better-auth' AND subject = ${betterUserId}
        ) AND revoked_at IS NULL
      `);
    },
  });
  app.addHook('onClose', () => auth.close());
  const database = db;
  app.route({
    method: ['GET', 'POST'],
    url: '/v1/auth/better/*',
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    async handler(request, reply) {
      const path = request.url
        .split('?')[0]
        ?.replace(/^\/v1\/auth\/better\//u, '');
      if (!path || !allowedAuthPaths.has(path))
        return reply.code(404).send({ code: 'NOT_FOUND' });
      // Better Auth endpoints never grant ShopAI merchant access by themselves.
      if (
        request.method === 'POST' &&
        (typeof request.headers.origin !== 'string' ||
          !app.authApi.allowedOrigins.has(request.headers.origin))
      )
        return reply.code(403).send({ code: 'FORBIDDEN_ORIGIN' });
      const upstream = await auth.handle(
        new Request(new URL(request.url, env.MCP_PUBLIC_ORIGIN), {
          method: request.method,
          headers: incomingHeaders(request),
          ...(request.method === 'POST'
            ? { body: JSON.stringify(request.body ?? {}) }
            : {}),
        }),
      );
      reply.code(upstream.status);
      upstream.headers.forEach((value, key) => {
        if (
          !['set-cookie', 'content-length', 'transfer-encoding'].includes(key)
        )
          reply.header(key, value);
      });
      const cookies = upstream.headers.getSetCookie();
      if (cookies.length) reply.header('Set-Cookie', cookies);
      const body = await upstream.text();
      if (!body) return reply.send();
      if (upstream.headers.get('content-type')?.includes('application/json')) {
        try {
          return reply.send(withoutBearerTokens(JSON.parse(body)));
        } catch {
          return reply.code(502).send({ code: 'AUTH_RESPONSE_INVALID' });
        }
      }
      return reply.send(body);
    },
  });

  app.post(
    '/v1/auth/better/complete',
    {
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      if (
        typeof request.headers.origin !== 'string' ||
        !app.authApi.allowedOrigins.has(request.headers.origin)
      )
        return reply.code(403).send({ code: 'FORBIDDEN_ORIGIN' });
      const parsed = completeSchema.safeParse(request.body);
      if (!parsed.success)
        return reply.code(400).send({ code: 'INVALID_INPUT' });
      const input = parsed.data;
      const identity = await auth.verifyCredentialMfa({
        email: input.email,
        password: input.password,
        totp: input.totp,
        backupCode: input.backupCode,
      });
      if (!identity)
        return reply.code(401).send({ code: 'CREDENTIAL_OR_MFA_INVALID' });
      const email = identity.email.trim().toLowerCase();
      let appUserId: string | null;
      try {
        appUserId = await database.transaction(async (tx) => {
          const mapped = await tx.execute(sql`
          SELECT u.id, u.email, u.account_status
          FROM user_identities AS i JOIN users AS u ON u.id = i.user_id
          WHERE i.issuer = 'better-auth' AND i.subject = ${identity.id}
          FOR UPDATE OF u
        `);
          const existingLink = mapped.rows[0];
          if (existingLink)
            return existingLink.account_status === 'active' &&
              existingLink.email === email &&
              typeof existingLink.id === 'string'
              ? existingLink.id
              : null;

          const existing = await tx.execute(sql`
          SELECT id, account_status FROM users WHERE email = ${email} FOR UPDATE
        `);
          const row = existing.rows[0];
          let userId: string;
          if (row) {
            if (
              row.account_status !== 'pilot' ||
              typeof row.id !== 'string' ||
              !input.pilotToken ||
              !app.authApi.verifyPilotCredential(email, input.pilotToken)
            )
              return null;
            userId = row.id;
            const conflicting = await tx.execute(
              sql`SELECT 1 FROM user_identities WHERE user_id = ${userId}::uuid`,
            );
            if (conflicting.rows.length) return null;
            await tx.execute(sql`
            UPDATE users SET account_status = 'active', email_verified_at = now()
            WHERE id = ${userId}::uuid
          `);
            await tx.execute(sql`
            UPDATE sessions SET revoked_at = now()
            WHERE user_id = ${userId}::uuid AND revoked_at IS NULL
          `);
          } else {
            const created = await tx.execute(sql`
            INSERT INTO users (email, account_status, email_verified_at)
            VALUES (${email}, 'active', now()) RETURNING id
          `);
            const id = created.rows[0]?.id;
            if (typeof id !== 'string')
              throw new Error('AUTH_USER_CREATE_FAILED');
            userId = id;
          }
          await tx.execute(sql`
          INSERT INTO user_identities (user_id, issuer, subject)
          VALUES (${userId}::uuid, 'better-auth', ${identity.id})
        `);
          return userId;
        });
      } catch (error) {
        if (
          error &&
          typeof error === 'object' &&
          'code' in error &&
          error.code === '23505'
        )
          return reply.code(409).send({ code: 'IDENTITY_LINK_CONFLICT' });
        throw error;
      }
      if (!appUserId)
        return reply.code(409).send({ code: 'IDENTITY_LINK_REQUIRED' });
      await app.authApi.issueIdentitySession(
        appUserId,
        input.client,
        'mfa',
        new Date(),
        reply,
      );
      return { user: { id: appUserId, email } };
    },
  );
}
