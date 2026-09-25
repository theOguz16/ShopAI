import { randomUUID } from 'node:crypto';
import {
  catalogSyncFailureStatus,
  STOCK_REVALIDATE_AFTER_MS,
  type CatalogSyncProgress,
} from '@shopai/commerce';
import {
  ConnectorHttpError,
  createLiveCatalogConnector,
  type LiveCatalogConnector,
  ManagedConnectorSecretStore,
  type ConnectorSecretBackend,
} from '@shopai/connectors';
import { type SyncJob, syncJobSchema } from '@shopai/contracts';
import {
  connections,
  connectorSecretAudit,
  connectorSecrets,
  type Database,
  inventory,
  merchantCredentialOwnerships,
  offers,
  setTenantContext,
  writeConnectionSyncProgress,
} from '@shopai/db';
import { and, eq, isNull, lte, or } from 'drizzle-orm';
import {
  runCatalogSyncEngine,
  type CatalogSyncEngineResult,
} from './catalog-sync-engine.js';
import {
  type AlertEmailSender,
  evaluateAndDeliverProductAlerts,
} from './product-alerts.js';

export interface SecretResolver {
  resolve(
    reference: string,
    scope?: { merchantId: string; connectionId: string; provider: string },
  ): Promise<unknown>;
}

export class EnvironmentSecretResolver implements SecretResolver {
  constructor(
    private readonly environment: NodeJS.ProcessEnv,
    private readonly backend?: ConnectorSecretBackend,
  ) {}
  async resolve(
    reference: string,
    scope?: { merchantId: string; connectionId: string; provider: string },
  ) {
    if (!reference.startsWith('secret://'))
      throw new Error('Yalnız secret:// referansları desteklenir.');
    const key = reference.slice('secret://'.length);
    if (!/^[A-Z][A-Z0-9_]{2,80}$/u.test(key))
      throw new Error('Geçersiz secret referansı.');
    if (ManagedConnectorSecretStore.supports(reference)) {
      if (this.backend) {
        if (!scope) throw new Error('Connector secret kapsamı gerekli.');
        return this.backend.resolveScoped(reference, scope);
      }
      const store = new ManagedConnectorSecretStore(
        this.environment.UPLOAD_DIR ?? 'private/uploads',
        this.environment.CONNECTOR_SECRET_ENCRYPTION_KEY,
      );
      return scope
        ? store.resolveScoped(reference, scope)
        : store.resolve(reference);
    }
    if (this.backend && this.environment.CONNECTOR_SECRET_BACKEND === 'openbao')
      throw new Error(
        'Legacy environment secret production ortamında desteklenmez.',
      );
    const value = this.environment[key];
    if (value) return JSON.parse(value);
    throw new Error('Secret çözülemedi.');
  }
}

type ConnectorFactory = (
  provider: string,
  credentials: unknown,
) => LiveCatalogConnector;

export const createConnector: ConnectorFactory = createLiveCatalogConnector;

export async function syncCatalogConnection(
  db: Database,
  input: SyncJob,
  secrets: SecretResolver,
  factory: ConnectorFactory = createConnector,
  now: () => Date = () => new Date(),
  alertEmailSender?: AlertEmailSender,
  correlationId?: string,
  expectedBackend?: 'file' | 'openbao',
  options: { batchSize?: number } = {},
) {
  const job = syncJobSchema.parse(input);
  const syncRunId = job.syncRunId ?? randomUUID();
  const startedAt = now();
  const connection = await db.transaction(async (tx) => {
    await setTenantContext(tx, job.merchantId);
    const [row] = await tx
      .select()
      .from(connections)
      .where(
        and(
          eq(connections.id, job.connectionId),
          eq(connections.merchantId, job.merchantId),
        ),
      );
    if (!row) return null;
    if (!row.active || row.authorizationStatus === 'revoked') {
      if (
        row.credentialsRef &&
        ManagedConnectorSecretStore.supports(row.credentialsRef)
      )
        await tx.insert(connectorSecretAudit).values({
          merchantId: job.merchantId,
          connectionId: job.connectionId,
          reference: row.credentialsRef,
          event: 'resolution_failed',
          actor: 'worker',
          correlationId,
        });
      return null;
    }
    if (!row.credentialsRef) return null;
    const [ownership] = await tx
      .select({ id: merchantCredentialOwnerships.id })
      .from(merchantCredentialOwnerships)
      .where(
        and(
          eq(merchantCredentialOwnerships.merchantId, job.merchantId),
          eq(merchantCredentialOwnerships.provider, row.provider),
          eq(merchantCredentialOwnerships.credentialsRef, row.credentialsRef),
        ),
      );
    if (!ownership) return null;
    if (ManagedConnectorSecretStore.supports(row.credentialsRef)) {
      const [secret] = await tx
        .select({ id: connectorSecrets.id })
        .from(connectorSecrets)
        .where(
          and(
            eq(connectorSecrets.merchantId, job.merchantId),
            eq(connectorSecrets.connectionId, job.connectionId),
            eq(connectorSecrets.provider, row.provider),
            eq(connectorSecrets.reference, row.credentialsRef),
            eq(connectorSecrets.status, 'active'),
            ...(expectedBackend
              ? [eq(connectorSecrets.backend, expectedBackend)]
              : []),
          ),
        )
        .limit(1);
      if (!secret) {
        await tx.insert(connectorSecretAudit).values({
          merchantId: job.merchantId,
          connectionId: job.connectionId,
          reference: row.credentialsRef,
          event: 'resolution_failed',
          actor: 'worker',
          correlationId,
        });
        return null;
      }
    }
    let effectiveSyncMode = row.syncMode as 'full' | 'incremental';
    if (effectiveSyncMode === 'incremental') {
      const revalidationCutoff = new Date(
        startedAt.getTime() - STOCK_REVALIDATE_AFTER_MS,
      );
      const [unverifiedOffer] = await tx
        .select({ id: offers.id })
        .from(offers)
        .leftJoin(
          inventory,
          and(
            eq(inventory.offerId, offers.id),
            eq(inventory.merchantId, offers.merchantId),
          ),
        )
        .where(
          and(
            eq(offers.connectionId, job.connectionId),
            eq(offers.merchantId, job.merchantId),
            eq(offers.active, true),
            or(
              isNull(inventory.fetchedAt),
              lte(inventory.fetchedAt, revalidationCutoff),
            ),
          ),
        )
        .limit(1);
      if (!row.lastSourceWatermarkAt || unverifiedOffer)
        effectiveSyncMode = 'full';
    }
    await tx
      .update(connections)
      .set({ lastSyncStartedAt: startedAt, lastSyncError: null })
      .where(eq(connections.id, row.id));
    return { ...row, effectiveSyncMode };
  });
  if (!connection) return { skipped: true } as const;

  let progress: CatalogSyncProgress = {
    status: 'running',
    foundProducts: 0,
    processedProducts: 0,
    failedProducts: 0,
    variants: 0,
  };
  let engineStarted = false;

  try {
    await writeConnectionSyncProgress(
      db,
      job.merchantId,
      job.connectionId,
      { ...progress, startedAt, completedAt: null, error: null },
      startedAt,
    );
    if (!connection.credentialsRef)
      throw new Error('Bağlantının secret referansı eksik.');
    const reference = connection.credentialsRef;
    let credentials: unknown;
    try {
      credentials = await secrets.resolve(reference, {
        merchantId: job.merchantId,
        connectionId: job.connectionId,
        provider: connection.provider,
      });
      if (ManagedConnectorSecretStore.supports(reference))
        await db.transaction(async (tx) => {
          await setTenantContext(tx, job.merchantId);
          await tx.insert(connectorSecretAudit).values({
            merchantId: job.merchantId,
            connectionId: job.connectionId,
            reference,
            event: 'accessed',
            actor: 'worker',
            correlationId,
          });
        });
    } catch {
      if (ManagedConnectorSecretStore.supports(reference))
        await db.transaction(async (tx) => {
          await setTenantContext(tx, job.merchantId);
          await tx.insert(connectorSecretAudit).values({
            merchantId: job.merchantId,
            connectionId: job.connectionId,
            reference,
            event: 'resolution_failed',
            actor: 'worker',
            correlationId,
          });
        });
      throw new Error('Connector secret çözülemedi.');
    }
    const connector = factory(connection.provider, credentials);
    await connector.validate();

    engineStarted = true;
    const result = await runCatalogSyncEngine({
      db,
      job,
      syncRunId,
      connector,
      mode: connection.effectiveSyncMode,
      modifiedAfter:
        connection.effectiveSyncMode === 'incremental'
          ? (connection.lastSourceWatermarkAt?.toISOString() ?? null)
          : null,
      credentialsRef: reference,
      batchSize: options.batchSize,
      now,
    });

    if (result.kind === 'skipped') {
      return {
        skipped: true,
        reason: result.reason,
        syncRunId,
      } as const;
    }

    const alertEvaluation = await evaluateAndDeliverProductAlertsSafe(
      db,
      job.merchantId,
      alertEmailSender,
    );

    return {
      skipped: false,
      imported: result.imported,
      complete: true,
      mode: result.mode,
      syncRunId,
      progress: {
        status: 'completed',
        foundProducts: result.counters.productsSeen,
        processedProducts: result.counters.productsSeen,
        failedProducts: 0,
        variants: result.counters.rowsSeen,
      },
      counters: result.counters,
      durationMs: result.completedAt.getTime() - result.startedAt.getTime(),
      alertEvaluation,
    } as const;
  } catch (error) {
    const message =
      error instanceof ConnectorHttpError
        ? `Connector HTTP ${error.status}`
        : 'Catalog sync failed';
    const failedAt = now();
    if (!engineStarted) {
      progress = {
        ...progress,
        status: catalogSyncFailureStatus(progress),
      };
      await writeConnectionSyncProgress(
        db,
        job.merchantId,
        job.connectionId,
        {
          ...progress,
          startedAt,
          completedAt: failedAt,
          error: message,
        },
        failedAt,
      );
    }
    await db.transaction(async (tx) => {
      await setTenantContext(tx, job.merchantId);
      await tx
        .update(connections)
        .set({
          lastSyncError: message,
          ...(error instanceof ConnectorHttpError &&
          error.reauthorizationRequired
            ? { authorizationStatus: 'reauthorization_required' }
            : {}),
        })
        .where(
          and(
            eq(connections.id, job.connectionId),
            eq(connections.active, true),
          ),
        );
    });
    throw error instanceof ConnectorHttpError
      ? new ConnectorHttpError(error.status, message, error.retryAfterMs)
      : new Error(message);
  }
}

async function evaluateAndDeliverProductAlertsSafe(
  db: Database,
  merchantId: string,
  alertEmailSender?: AlertEmailSender,
): Promise<
  | Awaited<ReturnType<typeof evaluateAndDeliverProductAlerts>>
  | { error: string }
> {
  try {
    return await evaluateAndDeliverProductAlerts(
      db,
      merchantId,
      alertEmailSender,
    );
  } catch {
    return { error: 'Alert evaluation failed' } as const;
  }
}

export type { CatalogSyncEngineResult };
export {
  CATALOG_IMPORT_BATCH_SIZE,
  chunkCatalogRows,
} from './catalog-sync-engine.js';
