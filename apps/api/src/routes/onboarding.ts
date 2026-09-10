import {
  ManagedConnectorSecretStore,
  WooCommerceConnector,
} from '@shopai/connectors';
import {
  connectorOnboardingResponseSchema,
  connectorTestResponseSchema,
  SYNC_QUEUE,
  woocommerceOnboardingCredentialsSchema,
} from '@shopai/contracts';
import {
  connections,
  merchantCredentialOwnerships,
  withTenant,
} from '@shopai/db';
import { Queue } from 'bullmq';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ApiEnv } from '../env.js';
import { requireRole, requireSameOrigin } from '../plugins/auth.js';

export async function registerOnboardingRoutes(
  app: FastifyInstance,
  env: ApiEnv,
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
    '/v1/merchants/:merchantId/onboarding/woocommerce/test',
    { preHandler: [requireSameOrigin, requireRole('owner', 'editor')] },
    async (request, reply) => {
      const parsed = woocommerceOnboardingCredentialsSchema.safeParse(
        request.body,
      );
      if (!parsed.success)
        return reply.code(400).send({ code: 'INVALID_INPUT' });
      try {
        await validateWooCommerce(parsed.data);
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
    '/v1/merchants/:merchantId/onboarding/woocommerce/connect',
    { preHandler: [requireSameOrigin, requireRole('owner', 'editor')] },
    async (request, reply) => {
      const parsed = woocommerceOnboardingCredentialsSchema.safeParse(
        request.body,
      );
      if (!parsed.success)
        return reply.code(400).send({ code: 'INVALID_INPUT' });
      const { merchantId } = request.params as { merchantId: string };
      const db = app.authApi.db;
      if (!db) return reply.code(503).send({ code: 'ONBOARDING_UNAVAILABLE' });

      try {
        await validateWooCommerce(parsed.data);
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
            provider: 'woocommerce';
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
                eq(connections.provider, 'woocommerce'),
                eq(connections.active, true),
              ),
            )
            .limit(1);
          if (existing) return 'exists' as const;

          await tx.insert(merchantCredentialOwnerships).values({
            merchantId,
            provider: 'woocommerce',
            credentialsRef,
          });
          const [connection] = await tx
            .insert(connections)
            .values({
              merchantId,
              provider: 'woocommerce',
              credentialsRef,
              syncMode: 'incremental',
              authorizationStatus: 'pending',
              conversionTrackingEnabled: Boolean(
                env.CONVERSION_CALLBACK_SECRET,
              ),
            })
            .returning({
              id: connections.id,
              provider: connections.provider,
              authorizationStatus: connections.authorizationStatus,
              syncMode: connections.syncMode,
            });
          if (!connection)
            throw new Error('WooCommerce bağlantısı oluşturulamadı.');
          return {
            id: connection.id,
            provider: 'woocommerce' as const,
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
          'woocommerce-sync',
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

async function validateWooCommerce(
  credentials: ReturnType<typeof woocommerceOnboardingCredentialsSchema.parse>,
) {
  // WooCommerceConnector's default HTTP transport resolves and validates the
  // destination, then opens TLS directly to that exact IP. There is no second
  // hostname lookup between the SSRF decision and the socket connection.
  await new WooCommerceConnector(credentials).validate();
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
