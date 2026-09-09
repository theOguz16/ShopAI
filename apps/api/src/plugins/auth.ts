import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Database } from '@shopai/db';
import {
  memberships,
  merchants,
  sessions,
  setTenantContext,
  users,
} from '@shopai/db';
import { and, asc, eq, gt } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ApiEnv } from '../env.js';

export type Role = 'owner' | 'editor' | 'viewer';
export type AuthContext = { userId: string; email: string };
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

const cookieName = 'shopai_session';
const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex');
const cookie = (request: FastifyRequest) =>
  request.headers.cookie
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${cookieName}=`))
    ?.slice(cookieName.length + 1);

export interface AuthApi {
  db: Database | undefined;
  allowedOrigins: ReadonlySet<string>;
  login(email: string, token: string, reply: FastifyReply): Promise<unknown>;
  authenticate(request: FastifyRequest): Promise<AuthContext | null>;
  logout(request: FastifyRequest, reply: FastifyReply): Promise<{ ok: true }>;
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
) {
  app.decorateRequest('auth', null);
  const requireDb = () => {
    if (!db)
      throw Object.assign(
        new Error('Kimlik servisi postgres modunda kullanılabilir.'),
        { statusCode: 503 },
      );
    return db;
  };
  const authApi: AuthApi = {
    db,
    allowedOrigins: new Set(env.MCP_ALLOWED_ORIGINS),
    async login(email: string, token: string, reply: FastifyReply) {
      const database = requireDb();
      const normalized = email.trim().toLowerCase();
      const configured = env.AUTH_PILOT_CREDENTIALS[normalized];
      // Use a fixed dummy value so unknown email and wrong token follow the
      // same comparison path and response.
      const expected = Buffer.from(
        hash(configured ?? 'invalid-credential-placeholder'),
        'hex',
      );
      const received = Buffer.from(hash(token), 'hex');
      const matches = timingSafeEqual(expected, received);
      if (!configured || !matches)
        return reply.code(401).send({ code: 'INVALID_CREDENTIALS' });
      const [user] = await database
        .insert(users)
        .values({ email: normalized })
        .onConflictDoUpdate({ target: users.email, set: { email: normalized } })
        .returning();
      if (!user) throw new Error('Kullanıcı oluşturulamadı.');
      const raw = randomBytes(32).toString('base64url');
      await database.insert(sessions).values({
        userId: user.id,
        tokenHash: hash(raw),
        expiresAt: new Date(Date.now() + env.SESSION_TTL_HOURS * 3600000),
      });
      reply.header(
        'Set-Cookie',
        `${cookieName}=${raw}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${env.SESSION_TTL_HOURS * 3600}`,
      );
      return { user: { id: user.id, email: user.email } };
    },
    async authenticate(request: FastifyRequest) {
      const raw = cookie(request);
      if (!raw || !db) return null;
      const [result] = await db
        .select({ userId: users.id, email: users.email })
        .from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .where(
          and(
            eq(sessions.tokenHash, hash(raw)),
            gt(sessions.expiresAt, new Date()),
          ),
        );
      return result ?? null;
    },
    async logout(request: FastifyRequest, reply: FastifyReply) {
      const raw = cookie(request);
      if (raw && db)
        await db.delete(sessions).where(eq(sessions.tokenHash, hash(raw)));
      reply.header(
        'Set-Cookie',
        `${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
      );
      return { ok: true };
    },
    async membership(request: FastifyRequest, merchantId: string) {
      if (!request.auth || !db) return undefined;
      const userId = request.auth.userId;
      return db.transaction(async (tx) => {
        await setTenantContext(tx, merchantId);
        const [membership] = await tx
          .select({ role: memberships.role })
          .from(memberships)
          .where(
            and(
              eq(memberships.userId, userId),
              eq(memberships.merchantId, merchantId),
            ),
          );
        return membership?.role as Role | undefined;
      });
    },
    async listMerchants(request: FastifyRequest) {
      if (!request.auth || !db) return [];
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
  app.addHook('preHandler', async (request) => {
    request.auth = await app.authApi.authenticate(request);
  });
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
    if (!request.auth) {
      return void reply.code(401).send({ code: 'UNAUTHENTICATED' });
    }
    if (!role || !allowed.includes(role)) {
      return void reply.code(403).send({ code: 'FORBIDDEN' });
    }
  };

export const requireSameOrigin = async (
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> => {
  const origin = request.headers.origin;
  if (origin && !request.server.authApi.allowedOrigins.has(origin))
    return void reply.code(403).send({ code: 'FORBIDDEN_ORIGIN' });
};
