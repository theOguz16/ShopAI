import {
  createLiveCatalogConnector,
  type LiveCatalogConnector,
  type ConnectorSecretBackend,
} from '@shopai/connectors';
import {
  connectorOnboardingProviderSchema,
  connectorOnboardingResponseSchema,
  connectorTestResponseSchema,
  type ConnectorOnboardingProvider,
  SYNC_QUEUE,
  trendyolOnboardingCredentialsSchema,
  woocommerceOnboardingCredentialsSchema,
} from '@shopai/contracts';
import { randomUUID } from 'node:crypto';
import {
  connections,
  connectorSecretAudit,
  connectorSecrets,
  connectionSyncProgress,
  merchantCredentialOwnerships,
  withTenant,
} from '@shopai/db';
import { Queue } from 'bullmq';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ApiEnv } from '../env.js';
import { requireRole, requireSameOrigin } from '../plugins/auth.js';

export type OnboardingConnectorFactory = (
  provider: ConnectorOnboardingProvider,
  credentials: unknown,
) => Pick<LiveCatalogConnector, 'validate'>;

const createOnboardingConnector: OnboardingConnectorFactory = (
  provider,
  credentials,
) => createLiveCatalogConnector(provider, credentials);

const onboardingCredentialSchemas = {
  woocommerce: woocommerceOnboardingCredentialsSchema,
  trendyol: trendyolOnboardingCredentialsSchema,
} as const;

export async function registerOnboardingRoutes(
  app: FastifyInstance,
  env: ApiEnv,
  secretStore: ConnectorSecretBackend,
  connectorFactory: OnboardingConnectorFactory = createOnboardingConnector,
) {
  let syncQueue: Queue | undefined;
  const getSyncQueue = () => {
    syncQueue ??= new Queue(SYNC_QUEUE, {
      connection: redisConnection(env.REDIS_URL),
    });
    return syncQueue;
  };
  app.addHook('onClose', async () => {
    await syncQueue?.close();
  });

  app.post(
    '/v1/merchants/:merchantId/connections/:connectionId/rotate-secret',
    { preHandler: [requireSameOrigin, requireRole('owner')] },
    async (request, reply) => {
      const { merchantId, connectionId } = request.params as {
        merchantId: string;
        connectionId: string;
      };
      const db = app.authApi.db;
      if (!db) return reply.code(503).send({ code: 'ONBOARDING_UNAVAILABLE' });
      const current = await withTenant(db, merchantId, async (tx) => {
        const [row] = await tx
          .select()
          .from(connections)
          .where(
            and(
              eq(connections.id, connectionId),
              eq(connections.merchantId, merchantId),
              eq(connections.active, true),
            ),
          )
          .limit(1);
        return row;
      });
      if (
        !current ||
        current.authorizationStatus === 'revoked' ||
        !current.credentialsRef ||
        (current.provider !== 'woocommerce' && current.provider !== 'trendyol')
      )
        return reply.code(404).send({ code: 'CONNECTION_NOT_FOUND' });
      const previousReference = current.credentialsRef;
      const provider = current.provider as ConnectorOnboardingProvider;
      const parsed = onboardingCredentialSchemas[provider].safeParse(
        request.body,
      );
      if (!parsed.success)
        return reply.code(400).send({ code: 'INVALID_INPUT' });
      const scope = { merchantId, connectionId, provider };
      const reference = await secretStore.rotateScoped(parsed.data, scope);
      try {
        await validateConnector(provider, parsed.data, connectorFactory);
      } catch {
        await secretStore.remove(reference, scope);
        return reply.code(422).send({ code: 'CONNECTION_FAILED' });
      }
      try {
        const rotated = await withTenant(db, merchantId, async (tx) => {
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtext(${connectionId}))`,
          );
          const [row] = await tx
            .select()
            .from(connections)
            .where(
              and(
                eq(connections.id, connectionId),
                eq(connections.merchantId, merchantId),
                eq(connections.active, true),
              ),
            )
            .limit(1)
            .for('update');
          if (
            !row ||
            row.authorizationStatus === 'revoked' ||
            row.credentialsRef !== current.credentialsRef
          )
            return false;
          const [old] = await tx
            .select()
            .from(connectorSecrets)
            .where(
              and(
                eq(connectorSecrets.merchantId, merchantId),
                eq(connectorSecrets.connectionId, connectionId),
                eq(connectorSecrets.reference, previousReference),
                eq(connectorSecrets.status, 'active'),
              ),
            )
            .limit(1);
          if (old)
            await tx
              .update(connectorSecrets)
              .set({ status: 'rotated', rotatedAt: new Date() })
              .where(eq(connectorSecrets.id, old.id));
          await tx.insert(connectorSecrets).values({
            merchantId,
            connectionId,
            provider,
            reference,
            backend: env.CONNECTOR_SECRET_BACKEND,
            version: old ? old.version + 1 : 1,
            status: 'active',
          });
          await tx
            .insert(merchantCredentialOwnerships)
            .values({ merchantId, provider, credentialsRef: reference });
          await tx
            .update(connections)
            .set({
              credentialsRef: reference,
              authorizationStatus: 'active',
              lastSyncError: null,
            })
            .where(
              and(
                eq(connections.id, connectionId),
                eq(connections.merchantId, merchantId),
              ),
            );
          await tx.insert(connectorSecretAudit).values({
            merchantId,
            connectionId,
            reference,
            event: 'created',
            actor: request.auth?.userId ?? 'api',
            correlationId: request.id,
          });
          await tx.insert(connectorSecretAudit).values({
            merchantId,
            connectionId,
            reference,
            event: 'rotated',
            actor: request.auth?.userId ?? 'api',
            correlationId: request.id,
          });
          return true;
        });
        if (!rotated) {
          await secretStore.remove(reference, scope);
          return reply.code(409).send({ code: 'CONNECTION_CHANGED' });
        }
        return { ok: true };
      } catch {
        await secretStore.remove(reference, scope).catch(() => undefined);
        return reply.code(500).send({ code: 'ROTATION_FAILED' });
      }
    },
  );
  app.post(
    '/v1/merchants/:merchantId/onboarding/:provider/test',
    { preHandler: [requireSameOrigin, requireRole('owner', 'editor')] },
    async (request, reply) => {
      const provider = parseProvider(request.params);
      if (!provider)
        return reply.code(404).send({ code: 'PROVIDER_NOT_FOUND' });
      const parsed = onboardingCredentialSchemas[provider].safeParse(
        request.body,
      );
      if (!parsed.success)
        return reply.code(400).send({ code: 'INVALID_INPUT' });
      try {
        await validateConnector(provider, parsed.data, connectorFactory);
        return connectorTestResponseSchema.parse({
          status: 'success',
          code: 'CONNECTION_OK',
        });
      } catch {
        return reply.code(422).send(
          connectorTestResponseSchema.parse({
            status: 'failed',
            code: 'CONNECTION_FAILED',
          }),
        );
      }
    },
  );

  app.post(
    '/v1/merchants/:merchantId/onboarding/:provider/connect',
    { preHandler: [requireSameOrigin, requireRole('owner', 'editor')] },
    async (request, reply) => {
      const provider = parseProvider(request.params);
      if (!provider)
        return reply.code(404).send({ code: 'PROVIDER_NOT_FOUND' });
      const parsed = onboardingCredentialSchemas[provider].safeParse(
        request.body,
      );
      if (!parsed.success)
        return reply.code(400).send({ code: 'INVALID_INPUT' });
      const { merchantId } = request.params as { merchantId: string };
      const db = app.authApi.db;
      if (!db) return reply.code(503).send({ code: 'ONBOARDING_UNAVAILABLE' });

      try {
        await validateConnector(provider, parsed.data, connectorFactory);
      } catch {
        return reply.code(422).send({
          status: 'failed',
          code: 'CONNECTION_FAILED',
        });
      }

      const connectionId = randomUUID();
      const scope = { merchantId, connectionId, provider };
      const credentialsRef = await secretStore.createScoped(parsed.data, scope);
      let created:
        | 'exists'
        | {
            id: string;
            provider: ConnectorOnboardingProvider;
            authorizationStatus: 'pending';
            syncMode: 'full' | 'incremental';
          };
      try {
        created = await withTenant(db, merchantId, async (tx) => {
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtext(${merchantId}))`,
          );
          const [existing] = await tx
            .select({ id: connections.id })
            .from(connections)
            .where(
              and(
                eq(connections.merchantId, merchantId),
                eq(connections.provider, provider),
                eq(connections.active, true),
              ),
            )
            .limit(1);
          if (existing) return 'exists' as const;

          await tx.insert(merchantCredentialOwnerships).values({
            merchantId,
            provider,
            credentialsRef,
          });
          const [connection] = await tx
            .insert(connections)
            .values({
              id: connectionId,
              merchantId,
              provider,
              credentialsRef,
              syncMode: 'incremental',
              authorizationStatus: 'pending',
              conversionTrackingEnabled: Boolean(
                env.CONVERSION_CALLBACK_SECRET,
              ),
            })
            .returning({
              id: connections.id,
              syncMode: connections.syncMode,
            });
          if (!connection)
            throw new Error(`${provider} bağlantısı oluşturulamadı.`);
          await tx.insert(connectorSecrets).values({
            merchantId,
            connectionId,
            provider,
            reference: credentialsRef,
            backend: env.CONNECTOR_SECRET_BACKEND,
            version: 1,
            status: 'active',
          });
          await tx.insert(connectorSecretAudit).values({
            merchantId,
            connectionId,
            reference: credentialsRef,
            event: 'created',
            actor: request.auth?.userId ?? 'api',
            correlationId: request.id,
          });
          await tx.insert(connectionSyncProgress).values({
            connectionId: connection.id,
            merchantId,
            status: 'queued',
            foundProducts: 0,
            processedProducts: 0,
            failedProducts: 0,
            variants: 0,
            startedAt: null,
            completedAt: null,
            error: null,
          });
          return {
            id: connection.id,
            provider,
            authorizationStatus: 'pending' as const,
            syncMode: connection.syncMode as 'full' | 'incremental',
          };
        });
      } catch (error) {
        await secretStore.remove(credentialsRef, scope).catch(() => undefined);
        throw error;
      }

      if (created === 'exists') {
        await secretStore.remove(credentialsRef, scope).catch(() => undefined);
        return reply.code(409).send({ code: 'CONNECTION_ALREADY_EXISTS' });
      }

      let syncStatus: 'queued' | 'pending_retry' = 'queued';
      try {
        await getSyncQueue().add(
          'catalog-sync',
          { merchantId, connectionId: created.id },
          {
            jobId: `onboarding-${created.id}`,
            attempts: 3,
            backoff: { type: 'exponential', delay: 5000 },
            removeOnComplete: 100,
            removeOnFail: 100,
          },
        );
      } catch {
        syncStatus = 'pending_retry';
        request.log.warn(
          {
            event: 'onboarding_sync_enqueue_failed',
            merchantId,
            connectionId: created.id,
            provider,
            error: 'queue_unavailable',
          },
          'First connector sync will be retried by the scheduler',
        );
      }

      return reply.code(201).send(
        connectorOnboardingResponseSchema.parse({
          connection: created,
          sync: { status: syncStatus },
        }),
      );
    },
  );
}

function parseProvider(params: unknown) {
  const value = params as { provider?: unknown };
  const parsed = connectorOnboardingProviderSchema.safeParse(value.provider);
  return parsed.success ? parsed.data : null;
}

async function validateConnector(
  provider: ConnectorOnboardingProvider,
  credentials: unknown,
  connectorFactory: OnboardingConnectorFactory,
) {
  await connectorFactory(provider, credentials).validate();
}

function redisConnection(value: string) {
  const url = new URL(value);
  return {
    host: url.hostname,
    port: Number(url.port || '6379'),
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
    maxRetriesPerRequest: 1,
  };
}
