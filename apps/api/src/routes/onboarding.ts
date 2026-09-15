import {
  createLiveCatalogConnector,
  type LiveCatalogConnector,
  ManagedConnectorSecretStore,
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
import {
  connections,
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
  connectorFactory: OnboardingConnectorFactory = createOnboardingConnector,
) {
  const secretStore = new ManagedConnectorSecretStore(env.UPLOAD_DIR);
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

      const credentialsRef = await secretStore.create(parsed.data);
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
        await secretStore.remove(credentialsRef).catch(() => undefined);
        throw error;
      }

      if (created === 'exists') {
        await secretStore.remove(credentialsRef).catch(() => undefined);
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
      } catch (error) {
        syncStatus = 'pending_retry';
        request.log.warn(
          {
            event: 'onboarding_sync_enqueue_failed',
            merchantId,
            connectionId: created.id,
            provider,
            error: error instanceof Error ? error.message : 'unknown',
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
