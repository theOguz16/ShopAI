import { randomUUID } from 'node:crypto';
import {
  catalogSyncFailureStatus,
  STOCK_REVALIDATE_AFTER_MS,
  type CatalogSyncProgress,
} from '@shopai/commerce';
import {
  ConnectorHttpError,
  type LiveCatalogConnector,
  ManagedConnectorSecretStore,
  WooCommerceConnector,
  type WooCommerceCredentials,
} from '@shopai/connectors';
import { type SyncJob, syncJobSchema } from '@shopai/contracts';
import {
  connections,
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

export interface SecretResolver {
  resolve(reference: string): Promise<unknown>;
}

export class EnvironmentSecretResolver implements SecretResolver {
  constructor(private readonly environment: NodeJS.ProcessEnv) {}
  async resolve(reference: string) {
    if (!reference.startsWith('secret://'))
      throw new Error('Yalnız secret:// referansları desteklenir.');
    const key = reference.slice('secret://'.length);
    if (!/^[A-Z][A-Z0-9_]{2,80}$/u.test(key))
      throw new Error('Geçersiz secret referansı.');
    const value = this.environment[key];
    if (value) return JSON.parse(value);
    if (ManagedConnectorSecretStore.supports(reference))
      return new ManagedConnectorSecretStore(
        this.environment.UPLOAD_DIR ?? 'private/uploads',
      ).resolve(reference);
    throw new Error(`Secret çözülemedi: ${key}`);
  }
}

type ConnectorFactory = (
  provider: string,
  credentials: unknown,
) => LiveCatalogConnector;

export const createConnector: ConnectorFactory = (provider, credentials) => {
  if (provider !== 'woocommerce')
    throw new Error(`Desteklenmeyen canlı connector: ${provider}`);
  return new WooCommerceConnector(credentials as WooCommerceCredentials);
};

export async function syncCatalogConnection(
  db: Database,
  input: SyncJob,
  secrets: SecretResolver,
  factory: ConnectorFactory = createConnector,
  now: () => Date = () => new Date(),
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
          eq(connections.active, true),
        ),
      );
    if (!row || row.authorizationStatus === 'revoked') return null;
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
      if (!row.lastSuccessfulSyncAt || unverifiedOffer)
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
    const connector = factory(
      connection.provider,
      await secrets.resolve(connection.credentialsRef),
    );
    await connector.validate();
    const snapshot = await collectCatalogSnapshot({
      connector,
      mode: connection.effectiveSyncMode,
      modifiedAfter:
        connection.effectiveSyncMode === 'incremental'
          ? (connection.lastSuccessfulSyncAt?.toISOString() ?? null)
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
      try {
        await importCatalog(db, {
          schemaVersion: 1,
          runId: randomUUID(),
          merchantId: job.merchantId,
          connectionId: job.connectionId,
          observedAt:
            snapshot.latestSourceTime ?? snapshot.latestFetchedAt,
          rows: snapshot.rows,
        });
      } catch (error) {
        progress = {
          ...snapshot.progress,
          processedProducts: 0,
          failedProducts: snapshot.progress.foundProducts,
        };
        throw error;
      }
    }

    const completedAt = now();
    progress = { ...snapshot.progress, status: 'completed' };
    await db.transaction(async (tx) => {
      await setTenantContext(tx, job.merchantId);
      // Only a successfully completed full snapshot may deactivate missing offers.
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
          lastSuccessfulSyncAt: new Date(
            snapshot.latestSourceTime ?? snapshot.latestFetchedAt,
          ),
          lastFetchedAt: new Date(snapshot.latestFetchedAt),
          lastSyncError: null,
        })
        .where(eq(connections.id, job.connectionId));
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
    return {
      skipped: false,
      imported: snapshot.rows.length,
      complete: snapshot.complete,
      mode: connection.effectiveSyncMode,
      progress,
    } as const;
  } catch (error) {
    const message =
      error instanceof Error ? error.message.slice(0, 1000) : 'Senkron hatası';
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
        .where(eq(connections.id, job.connectionId));
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
    throw error;
  }
}
