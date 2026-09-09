import { randomUUID } from 'node:crypto';
import {
  bootstrapMerchant,
  connections,
  memberships,
  merchantCredentialOwnerships,
  merchants,
  withTenant,
} from '@shopai/db';
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ApiEnv } from '../env.js';
import { requireRole, requireSameOrigin } from '../plugins/auth.js';

const errorChainIncludes = (error: unknown, marker: string) => {
  let current: unknown = error;
  while (current instanceof Error) {
    if (current.message.includes(marker)) return true;
    current = current.cause;
  }
  return false;
};

export async function registerMerchantRoutes(
  app: FastifyInstance,
  env: ApiEnv,
) {
  app.get('/v1/merchants', async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ code: 'UNAUTHENTICATED' });
    if (!app.authApi.db)
      return reply.code(503).send({ code: 'AUTH_UNAVAILABLE' });
    return { merchants: await app.authApi.listMerchants(request) };
  });
  app.post(
    '/v1/setup/merchant',
    { preHandler: [requireSameOrigin] },
    async (request, reply) => {
      if (!request.auth || !app.authApi.db)
        return reply.code(401).send({ code: 'UNAUTHENTICATED' });
      const body = request.body as { name?: string };
      if (!body?.name?.trim())
        return reply.code(400).send({ code: 'INVALID_INPUT' });
      const id = randomUUID();
      try {
        const merchant = await bootstrapMerchant(app.authApi.db, {
          userId: request.auth.userId,
          merchantId: id,
          name: body.name.trim(),
          slug: `pilot-${id.slice(0, 8)}`,
        });
        return reply.code(201).send({ merchant });
      } catch (error) {
        if (errorChainIncludes(error, 'SETUP_ALREADY_COMPLETED'))
          return reply.code(409).send({ code: 'SETUP_ALREADY_COMPLETED' });
        throw error;
      }
    },
  );
  app.get(
    '/v1/merchants/:merchantId',
    { preHandler: requireRole('owner', 'editor', 'viewer') },
    async (request, reply) => {
      const { merchantId } = request.params as { merchantId: string };
      const db = app.authApi.db;
      if (!db) return reply.code(503).send({ code: 'AUTH_UNAVAILABLE' });
      const merchant = await withTenant(db, merchantId, async (tx) => {
        const [row] = await tx
          .select()
          .from(merchants)
          .where(eq(merchants.id, merchantId));
        return row;
      });
      return merchant
        ? { merchant }
        : reply.code(404).send({ code: 'NOT_FOUND' });
    },
  );
  app.post(
    '/v1/merchants/:merchantId/connections',
    { preHandler: [requireSameOrigin, requireRole('owner', 'editor')] },
    async (request, reply) => {
      const { merchantId } = request.params as { merchantId: string };
      const body = request.body as {
        provider?: string;
        credentialsRef?: string;
        syncMode?: 'full' | 'incremental';
      };
      const csv = body?.provider === 'csv';
      const woocommerce = body?.provider === 'woocommerce';
      const syncMode = csv ? 'full' : (body.syncMode ?? 'incremental');
      if (
        (!csv && !woocommerce) ||
        (csv && body.credentialsRef !== undefined) ||
        (woocommerce &&
          !body.credentialsRef?.match(/^secret:\/\/[A-Z][A-Z0-9_]{2,80}$/u)) ||
        !['full', 'incremental'].includes(syncMode)
      )
        return reply.code(400).send({ code: 'INVALID_INPUT' });
      const provider: 'csv' | 'woocommerce' = csv ? 'csv' : 'woocommerce';
      const db = app.authApi.db;
      if (!db) return reply.code(503).send({ code: 'AUTH_UNAVAILABLE' });
      let connection:
        | 'exists'
        | 'credentials-owned-by-another-merchant'
        | typeof connections.$inferSelect
        | undefined;
      try {
        connection = await withTenant(db, merchantId, async (tx) => {
          const credentialsRef = csv ? null : body.credentialsRef;
          if (credentialsRef) {
            const [owner] = await tx
              .select({ merchantId: merchantCredentialOwnerships.merchantId })
              .from(merchantCredentialOwnerships)
              .where(
                and(
                  eq(merchantCredentialOwnerships.provider, provider),
                  eq(
                    merchantCredentialOwnerships.credentialsRef,
                    credentialsRef,
                  ),
                ),
              );
            if (owner && owner.merchantId !== merchantId)
              return 'credentials-owned-by-another-merchant' as const;
            if (!owner)
              await tx.insert(merchantCredentialOwnerships).values({
                merchantId,
                provider,
                credentialsRef,
              });
          }
          const [existing] = await tx
            .select({ id: connections.id })
            .from(connections)
            .where(
              and(
                eq(connections.merchantId, merchantId),
                eq(connections.provider, provider),
                eq(connections.active, true),
              ),
            );
          if (existing) return 'exists' as const;
          const [created] = await tx
            .insert(connections)
            .values({
              merchantId,
              provider,
              credentialsRef,
              syncMode,
              authorizationStatus: csv ? 'active' : 'pending',
              conversionTrackingEnabled:
                woocommerce && Boolean(env.CONVERSION_CALLBACK_SECRET),
            })
            .returning();
          return created;
        });
      } catch (error) {
        if (
          errorChainIncludes(
            error,
            'merchant_credential_ownerships_provider_credentials_ref_unique',
          )
        )
          return reply.code(403).send({ code: 'CREDENTIAL_REF_NOT_ASSIGNED' });
        throw error;
      }
      if (connection === 'exists')
        return reply.code(409).send({ code: 'CONNECTION_ALREADY_EXISTS' });
      if (connection === 'credentials-owned-by-another-merchant')
        return reply.code(403).send({ code: 'CREDENTIAL_REF_NOT_ASSIGNED' });
      if (!connection)
        return reply.code(500).send({ code: 'CONNECTION_CREATE_FAILED' });
      const { credentialsRef: _credentialsRef, ...safeConnection } = connection;
      return reply.code(201).send({ connection: safeConnection });
    },
  );
  app.get(
    '/v1/merchants/:merchantId/credential-refs',
    { preHandler: requireRole('owner', 'editor', 'viewer') },
    async (request, reply) => {
      const { merchantId } = request.params as { merchantId: string };
      const db = app.authApi.db;
      if (!db) return reply.code(503).send({ code: 'AUTH_UNAVAILABLE' });
      const credentialRefs = await withTenant(db, merchantId, (tx) =>
        tx
          .select({
            provider: merchantCredentialOwnerships.provider,
            credentialsRef: merchantCredentialOwnerships.credentialsRef,
          })
          .from(merchantCredentialOwnerships)
          .where(eq(merchantCredentialOwnerships.merchantId, merchantId)),
      );
      return { credentialRefs };
    },
  );
  app.get(
    '/v1/merchants/:merchantId/connections',
    { preHandler: requireRole('owner', 'editor', 'viewer') },
    async (request, reply) => {
      const { merchantId } = request.params as { merchantId: string };
      const db = app.authApi.db;
      if (!db) return reply.code(503).send({ code: 'AUTH_UNAVAILABLE' });
      return withTenant(db, merchantId, (tx) =>
        tx
          .select({
            id: connections.id,
            provider: connections.provider,
            active: connections.active,
            authorizationStatus: connections.authorizationStatus,
            syncMode: connections.syncMode,
            lastSyncStartedAt: connections.lastSyncStartedAt,
            lastSuccessfulSyncAt: connections.lastSuccessfulSyncAt,
            lastFetchedAt: connections.lastFetchedAt,
            lastSyncError: connections.lastSyncError,
            conversionTrackingEnabled: connections.conversionTrackingEnabled,
          })
          .from(connections)
          .where(
            and(
              eq(connections.merchantId, merchantId),
              eq(connections.active, true),
            ),
          )
          .orderBy(desc(connections.lastSyncStartedAt)),
      );
    },
  );
  app.delete(
    '/v1/merchants/:merchantId/connections/:connectionId',
    { preHandler: [requireSameOrigin, requireRole('owner')] },
    async (request, reply) => {
      const { merchantId, connectionId } = request.params as {
        merchantId: string;
        connectionId: string;
      };
      const db = app.authApi.db;
      if (!db) return reply.code(503).send({ code: 'AUTH_UNAVAILABLE' });
      const connection = await withTenant(db, merchantId, async (tx) => {
        const [row] = await tx
          .update(connections)
          .set({
            active: false,
            authorizationStatus: 'revoked',
            revokedAt: new Date(),
          })
          .where(
            and(
              eq(connections.id, connectionId),
              eq(connections.merchantId, merchantId),
            ),
          )
          .returning({ id: connections.id });
        return row;
      });
      return connection
        ? { ok: true }
        : reply.code(404).send({ code: 'NOT_FOUND' });
    },
  );
  app.post(
    '/v1/merchants/:merchantId/connections/:connectionId/reauthorize',
    { preHandler: [requireSameOrigin, requireRole('owner')] },
    async (request, reply) => {
      const { merchantId, connectionId } = request.params as {
        merchantId: string;
        connectionId: string;
      };
      const body = request.body as { credentialsRef?: string };
      if (!body.credentialsRef?.match(/^secret:\/\/[A-Z][A-Z0-9_]{2,80}$/u))
        return reply.code(400).send({ code: 'INVALID_INPUT' });
      const credentialsRef = body.credentialsRef;
      const db = app.authApi.db;
      if (!db) return reply.code(503).send({ code: 'AUTH_UNAVAILABLE' });
      const connection = await withTenant(db, merchantId, async (tx) => {
        const [owner] = await tx
          .select({ merchantId: merchantCredentialOwnerships.merchantId })
          .from(merchantCredentialOwnerships)
          .where(
            and(
              eq(merchantCredentialOwnerships.provider, 'woocommerce'),
              eq(merchantCredentialOwnerships.credentialsRef, credentialsRef),
            ),
          );
        if (!owner || owner.merchantId !== merchantId)
          return 'credentials-not-assigned' as const;
        const [row] = await tx
          .update(connections)
          .set({
            credentialsRef,
            active: true,
            authorizationStatus: 'pending',
            revokedAt: null,
            lastSyncError: null,
          })
          .where(
            and(
              eq(connections.id, connectionId),
              eq(connections.merchantId, merchantId),
            ),
          )
          .returning({ id: connections.id });
        return row;
      });
      if (connection === 'credentials-not-assigned')
        return reply.code(403).send({ code: 'CREDENTIAL_REF_NOT_ASSIGNED' });
      return connection
        ? { ok: true }
        : reply.code(404).send({ code: 'NOT_FOUND' });
    },
  );
  app.post(
    '/v1/merchants/:merchantId/members',
    { preHandler: [requireSameOrigin, requireRole('owner')] },
    async (request, reply) => {
      const { merchantId } = request.params as { merchantId: string };
      const body = request.body as {
        userId?: string;
        role?: 'owner' | 'editor' | 'viewer';
      };
      if (!body?.userId || !body.role)
        return reply.code(400).send({ code: 'INVALID_INPUT' });
      const db = app.authApi.db;
      if (!db) return reply.code(503).send({ code: 'AUTH_UNAVAILABLE' });
      const membership = await withTenant(db, merchantId, async (tx) => {
        const [row] = await tx
          .insert(memberships)
          .values({ merchantId, userId: body.userId, role: body.role })
          .returning();
        return row;
      });
      return reply.code(201).send({ membership });
    },
  );
}
