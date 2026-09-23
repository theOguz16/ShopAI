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
} from '@shopai/connectors';
import { type SourceRow, type SyncJob, syncJobSchema } from '@shopai/contracts';
import {
  connections,
  connectorSecretAudit,
  connectorSecrets,
  type Database,
  importCatalog,
  inventory,
  merchantCredentialOwnerships,
  offers,
  setTenantContext,
  writeConnectionSyncProgress,
} from '@shopai/db';
import { and, eq, isNull, lte, notInArray, or } from 'drizzle-orm';
import { collectCatalogSnapshot } from './catalog-sync-progress.js';
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
  constructor(private readonly environment: NodeJS.ProcessEnv) {}
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
      const store = new ManagedConnectorSecretStore(
        this.environment.UPLOAD_DIR ?? 'private/uploads',
        this.environment.CONNECTOR_SECRET_ENCRYPTION_KEY,
      );
      return scope
        ? store.resolveScoped(reference, scope)
        : store.resolve(reference);
    }
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
export const CATALOG_IMPORT_BATCH_SIZE = 1000;

export function chunkCatalogRows(
  rows: readonly SourceRow[],
  size = CATALOG_IMPORT_BATCH_SIZE,
) {
  if (!Number.isSafeInteger(size) || size < 1 || size > 1000)
    throw new Error('Catalog import batch size 1-1000 arasında olmalıdır.');
  const batches: SourceRow[][] = [];
  for (let offset = 0; offset < rows.length; offset += size)
    batches.push(rows.slice(offset, offset + size));
  return batches;
}

export async function syncCatalogConnection(
  db: Database,
  input: SyncJob,
  secrets: SecretResolver,
  factory: ConnectorFactory = createConnector,
  now: () => Date = () => new Date(),
  alertEmailSender?: AlertEmailSender,
  correlationId?: string,
) {
  const job = syncJobSchema.parse(input);
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
    const snapshot = await collectCatalogSnapshot({
      connector,
      mode: connection.effectiveSyncMode,
      modifiedAfter:
        connection.effectiveSyncMode === 'incremental'
          ? (connection.lastSourceWatermarkAt?.toISOString() ?? null)
          : null,
      onProgress: async (nextProgress) => {
        progress = nextProgress;
        await writeConnectionSyncProgress(
          db,
          job.merchantId,
          job.connectionId,
          { ...nextProgress, startedAt, completedAt: null, error: null },
          now(),
        );
      },
    });

    if (snapshot.rows.length) {
      const processedProductKeys = new Set<string>();
      try {
        for (const rows of chunkCatalogRows(snapshot.rows)) {
          await importCatalog(db, {
            schemaVersion: 1,
            runId: randomUUID(),
            merchantId: job.merchantId,
            connectionId: job.connectionId,
            observedAt: snapshot.latestSourceTime ?? snapshot.latestFetchedAt,
            rows,
          });
          for (const row of rows) processedProductKeys.add(row.productKey);
          progress = {
            status: 'running',
            foundProducts: snapshot.progress.foundProducts,
            processedProducts: processedProductKeys.size,
            failedProducts: 0,
            variants: snapshot.progress.variants,
          };
          await writeConnectionSyncProgress(
            db,
            job.merchantId,
            job.connectionId,
            {
              ...progress,
              startedAt,
              completedAt: null,
              error: null,
            },
            now(),
          );
        }
      } catch (error) {
        progress = {
          ...snapshot.progress,
          processedProducts: processedProductKeys.size,
          failedProducts: Math.max(
            0,
            snapshot.progress.foundProducts - processedProductKeys.size,
          ),
        };
        throw error;
      }
    }

    const completedAt = now();
    progress = {
      ...progress,
      status: 'completed',
      processedProducts: snapshot.progress.foundProducts,
    };
    await db.transaction(async (tx) => {
      await setTenantContext(tx, job.merchantId);
      const [live] = await tx
        .select({
          active: connections.active,
          authorizationStatus: connections.authorizationStatus,
          credentialsRef: connections.credentialsRef,
        })
        .from(connections)
        .where(
          and(
            eq(connections.id, job.connectionId),
            eq(connections.merchantId, job.merchantId),
          ),
        )
        .limit(1)
        .for('update');
      if (
        !live?.active ||
        live.authorizationStatus === 'revoked' ||
        live.credentialsRef !== connection.credentialsRef
      )
        throw new Error('Connection changed during sync.');
      if (connection.effectiveSyncMode === 'full') {
        const scope = and(
          eq(offers.connectionId, job.connectionId),
          eq(offers.merchantId, job.merchantId),
        );
        await tx
          .update(offers)
          .set({ active: false })
          .where(
            snapshot.externalIds.size
              ? and(
                  scope,
                  notInArray(offers.externalId, [...snapshot.externalIds]),
                )
              : scope,
          );
      }
      await tx
        .update(connections)
        .set({
          authorizationStatus: 'active',
          syncCursor: null,
          lastSourceWatermarkAt: snapshot.latestSourceTime
            ? new Date(snapshot.latestSourceTime)
            : connection.lastSourceWatermarkAt,
          lastSuccessfulSyncAt: completedAt,
          lastFetchedAt: new Date(snapshot.latestFetchedAt),
          lastSyncError: null,
        })
        .where(
          and(
            eq(connections.id, job.connectionId),
            eq(connections.active, true),
          ),
        );
    });
    await writeConnectionSyncProgress(
      db,
      job.merchantId,
      job.connectionId,
      {
        ...progress,
        startedAt,
        completedAt,
        error: null,
      },
      completedAt,
    );

    let alertEvaluation:
      | Awaited<ReturnType<typeof evaluateAndDeliverProductAlerts>>
      | { error: string };
    try {
      alertEvaluation = await evaluateAndDeliverProductAlerts(
        db,
        job.merchantId,
        alertEmailSender,
      );
    } catch {
      alertEvaluation = { error: 'Alert evaluation failed' };
    }

    return {
      skipped: false,
      imported: snapshot.rows.length,
      complete: snapshot.complete,
      mode: connection.effectiveSyncMode,
      progress,
      alertEvaluation,
    } as const;
  } catch (error) {
    const message =
      error instanceof ConnectorHttpError
        ? `Connector HTTP ${error.status}`
        : 'Catalog sync failed';
    const failedAt = now();
    progress = {
      ...progress,
      status: catalogSyncFailureStatus(progress),
    };
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
    throw error instanceof ConnectorHttpError
      ? new ConnectorHttpError(error.status, message, error.retryAfterMs)
      : new Error(message);
  }
}
