import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  type ConnectorSecretBackend,
  createLiveCatalogConnector,
  type LiveCatalogConnector,
  normalizeConnectorStoreUrl,
} from '@shopai/connectors';
import {
  type ConnectorOnboardingProvider,
  SYNC_QUEUE,
  woocommercePairingCompleteResponseSchema,
  woocommercePairingCompleteSchema,
  woocommercePairingCreatedResponseSchema,
  woocommercePairingCreateSchema,
} from '@shopai/contracts';
import {
  connectionAudit,
  connectionPairings,
  connectionSyncProgress,
  connections,
  connectorSecretAudit,
  connectorSecrets,
  merchantCredentialOwnerships,
  withTenant,
} from '@shopai/db';
import { Queue } from 'bullmq';
import { and, eq, ne, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ApiEnv } from '../env.js';
import { requireRole, requireSameOrigin } from '../plugins/auth.js';

export type PairingConnectorFactory = (
  provider: ConnectorOnboardingProvider,
  credentials: unknown,
) => Pick<LiveCatalogConnector, 'validate'>;

const createPairingConnector: PairingConnectorFactory = (
  provider,
  credentials,
) => createLiveCatalogConnector(provider, credentials);

const PAIRING_TOKEN_HEADER = 'x-shopai-pairing-token';
// 32 random bytes, base64url — 43 characters, no padding.
const PAIRING_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const PLUGIN_ACTOR = 'woocommerce_plugin';

const hashPairingToken = (token: string) =>
  createHash('sha256').update(token, 'utf8').digest('hex');

const isStoreOwnershipConflict = (error: unknown) => {
  let current: unknown = error;
  while (current instanceof Error || (current && typeof current === 'object')) {
    const record = current as {
      code?: string;
      constraint?: string;
      cause?: unknown;
    };
    if (
      record.code === '23505' &&
      (record.constraint?.includes('store_unique') ||
        record.constraint === undefined)
    )
      return true;
    current = record.cause;
  }
  return false;
};

const canonicalCredentials = (value: unknown) => {
  if (typeof value !== 'object' || value === null) return '';
  const record = value as Record<string, unknown>;
  return JSON.stringify(
    Object.keys(record)
      .sort()
      .map((key) => [key, record[key]]),
  );
};

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

export async function registerPairingRoutes(
  app: FastifyInstance,
  env: ApiEnv,
  secretStore: ConnectorSecretBackend,
  connectorFactory: PairingConnectorFactory = createPairingConnector,
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
    '/v1/merchants/:merchantId/connections/woocommerce/pairing',
    { preHandler: [requireSameOrigin, requireRole('owner', 'editor')] },
    async (request, reply) => {
      const { merchantId } = request.params as { merchantId: string };
      const db = app.authApi.db;
      if (!db) return reply.code(503).send({ code: 'PAIRING_UNAVAILABLE' });
      const parsed = woocommercePairingCreateSchema.safeParse(request.body);
      if (!parsed.success)
        return reply.code(400).send({ code: 'INVALID_INPUT' });
      const storeUrl = normalizeConnectorStoreUrl(parsed.data.storeUrl);
      if (!storeUrl) return reply.code(400).send({ code: 'INVALID_INPUT' });
      const actor = request.auth?.userId ?? 'api';

      // Cross-tenant ownership probe: source_connections RLS intentionally
      // hides other merchants inside withTenant, so the conflict pre-check
      // runs in a plain transaction. The partial unique index
      // source_connections_active_store_unique remains the hard guarantee.
      const [conflict] = await db.transaction(async (tx) =>
        tx
          .select({
            id: connections.id,
            merchantId: connections.merchantId,
          })
          .from(connections)
          .where(
            and(
              eq(connections.provider, 'woocommerce'),
              eq(connections.storeUrl, storeUrl),
              eq(connections.active, true),
              ne(connections.authorizationStatus, 'revoked'),
            ),
          )
          .limit(1),
      );
      if (conflict && conflict.merchantId !== merchantId) {
        await withTenant(db, merchantId, async (tx) => {
          // No connectionId: the conflicting connection belongs to another
          // merchant and the composite FK is tenant-scoped.
          await tx.insert(connectionAudit).values({
            merchantId,
            connectionId: null,
            provider: 'woocommerce',
            event: 'pairing_rejected',
            actor,
            result: 'failure',
            detail: { reason: 'store_conflict', storeUrl },
            correlationId: request.id,
          });
        });
        return reply.code(409).send({ code: 'STORE_OWNERSHIP_CONFLICT' });
      }
      const created = await withTenant(db, merchantId, async (tx) => {
        const rawToken = randomBytes(32).toString('base64url');
        const expiresAt = new Date(
          Date.now() + env.PAIRING_TOKEN_TTL_MINUTES * 60_000,
        );
        const [pairing] = await tx
          .insert(connectionPairings)
          .values({
            merchantId,
            provider: 'woocommerce',
            createdBy: request.auth?.userId ?? actor,
            tokenHash: hashPairingToken(rawToken),
            storeUrl,
            expiresAt,
          })
          .returning({
            id: connectionPairings.id,
            expiresAt: connectionPairings.expiresAt,
          });
        if (!pairing) throw new Error('Pairing oluşturulamadı.');
        await tx.insert(connectionAudit).values({
          merchantId,
          provider: 'woocommerce',
          event: 'pairing_created',
          actor,
          result: 'success',
          detail: {
            pairingId: pairing.id,
            storeUrl,
            ...(conflict ? { mode: 'reconnect' } : {}),
          },
          correlationId: request.id,
        });
        return { pairing, rawToken };
      });

      return reply.code(201).send(
        woocommercePairingCreatedResponseSchema.parse({
          pairing: {
            id: created.pairing.id,
            provider: 'woocommerce',
            storeUrl,
            pairingToken: created.rawToken,
            expiresAt: created.pairing.expiresAt.toISOString(),
          },
        }),
      );
    },
  );

  app.post(
    '/v1/connectors/woocommerce/pairings/complete',
    {
      config: {
        rateLimit: {
          max: env.PAIRING_COMPLETE_RATE_LIMIT_MAX,
          timeWindow: '1 minute',
        },
      },
      preHandler: [requireSameOrigin],
    },
    async (request, reply) => {
      const db = app.authApi.db;
      if (!db) return reply.code(503).send({ code: 'PAIRING_UNAVAILABLE' });
      const parsed = woocommercePairingCompleteSchema.safeParse(request.body);
      if (!parsed.success)
        return reply.code(400).send({ code: 'INVALID_INPUT' });
      const header = request.headers[PAIRING_TOKEN_HEADER];
      const token = (
        typeof header === 'string'
          ? header
          : Array.isArray(header)
            ? header[0]
            : ''
      )?.trim();
      if (!token || !PAIRING_TOKEN_PATTERN.test(token))
        return reply.code(404).send({ code: 'PAIRING_INVALID' });
      const tokenHash = hashPairingToken(token);

      // Pairing lookup without holding a transaction across the live
      // credential validation below; consume happens in the activation
      // transaction at the end.
      const pairing = await db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(connectionPairings)
          .where(eq(connectionPairings.tokenHash, tokenHash))
          .limit(1);
        if (!row) return undefined;
        if (row.status === 'pending' && row.expiresAt <= new Date()) {
          await tx
            .update(connectionPairings)
            .set({ status: 'expired' })
            .where(eq(connectionPairings.id, row.id));
          await tx.insert(connectionAudit).values({
            merchantId: row.merchantId,
            provider: row.provider,
            event: 'pairing_rejected',
            actor: PLUGIN_ACTOR,
            result: 'failure',
            detail: { reason: 'expired', pairingId: row.id },
            correlationId: request.id,
          });
          return undefined;
        }
        if (row.status !== 'pending') {
          await tx.insert(connectionAudit).values({
            merchantId: row.merchantId,
            provider: row.provider,
            event: 'pairing_rejected',
            actor: PLUGIN_ACTOR,
            result: 'failure',
            detail: {
              reason: row.status === 'consumed' ? 'replay' : row.status,
              pairingId: row.id,
            },
            correlationId: request.id,
          });
          return undefined;
        }
        return row;
      });
      if (!pairing) return reply.code(404).send({ code: 'PAIRING_INVALID' });

      const pluginStoreUrl = normalizeConnectorStoreUrl(parsed.data.siteUrl);
      const credentialStoreUrl = normalizeConnectorStoreUrl(
        parsed.data.credentials.storeUrl,
      );
      if (
        pluginStoreUrl !== pairing.storeUrl ||
        credentialStoreUrl !== pairing.storeUrl
      ) {
        await withTenant(db, pairing.merchantId, async (tx) => {
          await tx.insert(connectionAudit).values({
            merchantId: pairing.merchantId,
            provider: 'woocommerce',
            event: 'pairing_rejected',
            actor: PLUGIN_ACTOR,
            result: 'failure',
            detail: { reason: 'store_mismatch', pairingId: pairing.id },
            correlationId: request.id,
          });
        });
        return reply.code(404).send({ code: 'PAIRING_INVALID' });
      }

      // Choose the final connection ID before writing a scoped secret. A
      // reconnect must use the existing ID that the worker will resolve with.
      const [existingConnection] = await db.transaction(async (tx) =>
        tx
          .select({ id: connections.id, merchantId: connections.merchantId })
          .from(connections)
          .where(
            and(
              eq(connections.provider, 'woocommerce'),
              eq(connections.storeUrl, pairing.storeUrl),
              eq(connections.active, true),
              ne(connections.authorizationStatus, 'revoked'),
            ),
          )
          .limit(1),
      );
      if (
        existingConnection &&
        existingConnection.merchantId !== pairing.merchantId
      ) {
        await withTenant(db, pairing.merchantId, async (tx) => {
          await tx.insert(connectionAudit).values({
            merchantId: pairing.merchantId,
            provider: 'woocommerce',
            event: 'pairing_rejected',
            actor: PLUGIN_ACTOR,
            result: 'failure',
            detail: { reason: 'store_conflict', pairingId: pairing.id },
            correlationId: request.id,
          });
        });
        return reply.code(409).send({ code: 'STORE_OWNERSHIP_CONFLICT' });
      }
      const connectionId = existingConnection?.id ?? randomUUID();

      try {
        await connectorFactory(
          'woocommerce',
          parsed.data.credentials,
        ).validate();
      } catch {
        await withTenant(db, pairing.merchantId, async (tx) => {
          await tx.insert(connectionAudit).values({
            merchantId: pairing.merchantId,
            provider: 'woocommerce',
            event: 'validation_failed',
            actor: PLUGIN_ACTOR,
            result: 'failure',
            detail: { pairingId: pairing.id, storeUrl: pairing.storeUrl },
            correlationId: request.id,
          });
        });
        return reply.code(422).send({ code: 'CONNECTION_FAILED' });
      }

      const scope = {
        merchantId: pairing.merchantId,
        connectionId,
        provider: 'woocommerce',
      } as const;
      const reference = await secretStore.createScoped(
        parsed.data.credentials,
        scope,
      );
      // Managed-secret read-back: activation only proceeds when the backend
      // resolves exactly what the plugin handed off.
      const resolved = await secretStore.resolveScoped(reference, scope);
      if (
        canonicalCredentials(resolved) !==
        canonicalCredentials(parsed.data.credentials)
      ) {
        await secretStore.remove(reference, scope).catch(() => undefined);
        return reply.code(500).send({ code: 'SECRET_VERIFY_FAILED' });
      }

      let outcome:
        | 'store_conflict'
        | {
            mode: 'connected' | 'reconnected';
            connection: {
              id: string;
              provider: 'woocommerce';
              authorizationStatus: 'pending' | 'active';
              syncMode: 'full' | 'incremental';
            };
          }
        | undefined;
      try {
        outcome = await withTenant(db, pairing.merchantId, async (tx) => {
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtext(${pairing.merchantId}))`,
          );
          const [current] = await tx
            .select()
            .from(connectionPairings)
            .where(eq(connectionPairings.id, pairing.id))
            .limit(1)
            .for('update');
          if (
            !current ||
            current.status !== 'pending' ||
            current.expiresAt <= new Date()
          )
            return undefined;

          const [conflict] = await tx
            .select()
            .from(connections)
            .where(
              and(
                eq(connections.provider, 'woocommerce'),
                eq(connections.storeUrl, pairing.storeUrl),
                eq(connections.active, true),
                ne(connections.authorizationStatus, 'revoked'),
              ),
            )
            .limit(1);
          // A connection may have been revoked or replaced while the Woo
          // validation request was in flight. Never attach a secret scoped to
          // another ID to that replacement.
          if (
            (conflict &&
              (conflict.merchantId !== pairing.merchantId ||
                conflict.id !== connectionId)) ||
            (existingConnection && !conflict)
          ) {
            // No connectionId: the conflicting connection belongs to another
            // merchant and the composite FK is tenant-scoped.
            await tx.insert(connectionAudit).values({
              merchantId: pairing.merchantId,
              connectionId: null,
              provider: 'woocommerce',
              event: 'pairing_rejected',
              actor: PLUGIN_ACTOR,
              result: 'failure',
              detail: { reason: 'store_conflict', pairingId: pairing.id },
              correlationId: request.id,
            });
            return 'store_conflict' as const;
          }

          await tx
            .insert(merchantCredentialOwnerships)
            .values({
              merchantId: pairing.merchantId,
              provider: 'woocommerce',
              credentialsRef: reference,
            })
            .onConflictDoNothing();

          if (conflict) {
            // Reconnect: rotate the existing connection's active reference;
            // the old credential keeps working until this transaction commits.
            const [old] = await tx
              .select()
              .from(connectorSecrets)
              .where(
                and(
                  eq(connectorSecrets.merchantId, pairing.merchantId),
                  eq(connectorSecrets.connectionId, conflict.id),
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
              merchantId: pairing.merchantId,
              connectionId: conflict.id,
              provider: 'woocommerce',
              reference,
              backend: env.CONNECTOR_SECRET_BACKEND,
              version: old ? old.version + 1 : 1,
              status: 'active',
            });
            await tx
              .update(connections)
              .set({
                credentialsRef: reference,
                authorizationStatus: 'active',
                lastSyncError: null,
                storeUrl: pairing.storeUrl,
                storeName: parsed.data.siteName,
                connectedVia: 'plugin_pairing',
              })
              .where(
                and(
                  eq(connections.id, conflict.id),
                  eq(connections.merchantId, pairing.merchantId),
                ),
              );
            await tx.insert(connectorSecretAudit).values([
              {
                merchantId: pairing.merchantId,
                connectionId: conflict.id,
                reference,
                event: 'created',
                actor: PLUGIN_ACTOR,
                correlationId: request.id,
              },
              {
                merchantId: pairing.merchantId,
                connectionId: conflict.id,
                reference,
                event: 'rotated',
                actor: PLUGIN_ACTOR,
                correlationId: request.id,
              },
            ]);
            await tx
              .update(connectionPairings)
              .set({
                status: 'consumed',
                consumedAt: new Date(),
                consumedConnectionId: conflict.id,
              })
              .where(eq(connectionPairings.id, pairing.id));
            await tx.insert(connectionAudit).values([
              {
                merchantId: pairing.merchantId,
                connectionId: conflict.id,
                provider: 'woocommerce',
                event: 'connection_reconnected',
                actor: PLUGIN_ACTOR,
                result: 'success',
                detail: { pairingId: pairing.id },
                correlationId: request.id,
              },
              {
                merchantId: pairing.merchantId,
                connectionId: conflict.id,
                provider: 'woocommerce',
                event: 'pairing_consumed',
                actor: PLUGIN_ACTOR,
                result: 'success',
                detail: { pairingId: pairing.id },
                correlationId: request.id,
              },
            ]);
            return {
              mode: 'reconnected' as const,
              connection: {
                id: conflict.id,
                provider: 'woocommerce' as const,
                authorizationStatus: 'active' as const,
                syncMode: conflict.syncMode as 'full' | 'incremental',
              },
            };
          }

          const [connection] = await tx
            .insert(connections)
            .values({
              id: connectionId,
              merchantId: pairing.merchantId,
              provider: 'woocommerce',
              credentialsRef: reference,
              syncMode: 'incremental',
              authorizationStatus: 'pending',
              connectedVia: 'plugin_pairing',
              storeUrl: pairing.storeUrl,
              storeName: parsed.data.siteName,
              conversionTrackingEnabled: Boolean(
                env.CONVERSION_CALLBACK_SECRET,
              ),
            })
            .returning({
              id: connections.id,
              syncMode: connections.syncMode,
            });
          if (!connection)
            throw new Error('WooCommerce bağlantısı oluşturulamadı.');
          await tx.insert(connectorSecrets).values({
            merchantId: pairing.merchantId,
            connectionId: connection.id,
            provider: 'woocommerce',
            reference,
            backend: env.CONNECTOR_SECRET_BACKEND,
            version: 1,
            status: 'active',
          });
          await tx.insert(connectorSecretAudit).values({
            merchantId: pairing.merchantId,
            connectionId: connection.id,
            reference,
            event: 'created',
            actor: PLUGIN_ACTOR,
            correlationId: request.id,
          });
          await tx.insert(connectionSyncProgress).values({
            connectionId: connection.id,
            merchantId: pairing.merchantId,
            status: 'queued',
            foundProducts: 0,
            processedProducts: 0,
            failedProducts: 0,
            variants: 0,
            startedAt: null,
            completedAt: null,
            error: null,
          });
          await tx
            .update(connectionPairings)
            .set({
              status: 'consumed',
              consumedAt: new Date(),
              consumedConnectionId: connection.id,
            })
            .where(eq(connectionPairings.id, pairing.id));
          await tx.insert(connectionAudit).values([
            {
              merchantId: pairing.merchantId,
              connectionId: connection.id,
              provider: 'woocommerce',
              event: 'connection_created',
              actor: PLUGIN_ACTOR,
              result: 'success',
              detail: { pairingId: pairing.id },
              correlationId: request.id,
            },
            {
              merchantId: pairing.merchantId,
              connectionId: connection.id,
              provider: 'woocommerce',
              event: 'pairing_consumed',
              actor: PLUGIN_ACTOR,
              result: 'success',
              detail: { pairingId: pairing.id },
              correlationId: request.id,
            },
          ]);
          return {
            mode: 'connected' as const,
            connection: {
              id: connection.id,
              provider: 'woocommerce' as const,
              authorizationStatus: 'pending' as const,
              syncMode: connection.syncMode as 'full' | 'incremental',
            },
          };
        });
      } catch (error) {
        await secretStore.remove(reference, scope).catch(() => undefined);
        if (isStoreOwnershipConflict(error)) {
          // The partial unique index rejected a second owner for the same
          // store; the transaction rolled back so the pairing stays pending.
          await withTenant(db, pairing.merchantId, async (tx) => {
            await tx.insert(connectionAudit).values({
              merchantId: pairing.merchantId,
              connectionId: null,
              provider: 'woocommerce',
              event: 'pairing_rejected',
              actor: PLUGIN_ACTOR,
              result: 'failure',
              detail: { reason: 'store_conflict', pairingId: pairing.id },
              correlationId: request.id,
            });
          }).catch(() => undefined);
          return reply.code(409).send({ code: 'STORE_OWNERSHIP_CONFLICT' });
        }
        throw error;
      }

      if (!outcome) {
        await secretStore.remove(reference, scope).catch(() => undefined);
        return reply.code(409).send({ code: 'PAIRING_STATE_CHANGED' });
      }
      if (outcome === 'store_conflict') {
        await secretStore.remove(reference, scope).catch(() => undefined);
        return reply.code(409).send({ code: 'STORE_OWNERSHIP_CONFLICT' });
      }

      if (outcome.mode === 'connected') {
        try {
          await getSyncQueue().add(
            'catalog-sync',
            {
              merchantId: pairing.merchantId,
              connectionId: outcome.connection.id,
            },
            {
              jobId: `pairing-${outcome.connection.id}`,
              attempts: 3,
              backoff: { type: 'exponential', delay: 5000 },
              removeOnComplete: 100,
              removeOnFail: 100,
            },
          );
        } catch {
          request.log.warn(
            {
              event: 'pairing_sync_enqueue_failed',
              merchantId: pairing.merchantId,
              connectionId: outcome.connection.id,
            },
            'First connector sync will be retried by the scheduler',
          );
        }
      }

      return reply.code(201).send(
        woocommercePairingCompleteResponseSchema.parse({
          connection: outcome.connection,
          store: { url: pairing.storeUrl, name: parsed.data.siteName },
          mode: outcome.mode,
        }),
      );
    },
  );
}
