import { randomUUID } from 'node:crypto';
import { STOCK_REVALIDATE_AFTER_MS } from '@shopai/commerce';
import {
  ConnectorHttpError,
  type LiveCatalogConnector,
  ManagedConnectorSecretStore,
  WooCommerceConnector,
  type WooCommerceCredentials,
} from '@shopai/connectors';
import type { SourceRow } from '@shopai/contracts';
import { type SyncJob, syncJobSchema } from '@shopai/contracts';
import {
  connections,
  type Database,
  importCatalog,
  inventory,
  merchantCredentialOwnerships,
  offers,
  setTenantContext,
} from '@shopai/db';
import { and, eq, isNull, lte, notInArray, or } from 'drizzle-orm';

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
        now().getTime() - STOCK_REVALIDATE_AFTER_MS,
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
      .set({ lastSyncStartedAt: now(), lastSyncError: null })
      .where(eq(connections.id, row.id));
    return { ...row, effectiveSyncMode };
  });
  if (!connection) return { skipped: true } as const;

  try {
    if (!connection.credentialsRef)
      throw new Error('Bağlantının secret referansı eksik.');
    const connector = factory(
      connection.provider,
      await secrets.resolve(connection.credentialsRef),
    );
    await connector.validate();
    const rows: SourceRow[] = [];
    const externalIds = new Set<string>();
    let cursor: string | null = null;
    let latestSourceTime =
      connection.lastSuccessfulSyncAt?.toISOString() ?? null;
    let latestFetchedAt = new Date().toISOString();
    let complete = false;
    for (let pageCount = 0; pageCount < 100; pageCount += 1) {
      const page = await connector.readPage({
        cursor,
        modifiedAfter:
          connection.effectiveSyncMode === 'incremental'
            ? connection.lastSuccessfulSyncAt?.toISOString()
            : null,
        mode: connection.effectiveSyncMode,
      });
      for (const row of page.rows) {
        rows.push(row);
        externalIds.add(row.externalId);
      }
      latestSourceTime = [latestSourceTime, page.sourceObservedAt]
        .filter(Boolean)
        .sort()
        .at(-1) as string;
      latestFetchedAt = page.fetchedAt;
      cursor = page.nextCursor;
      complete = page.complete && !cursor;
      if (!cursor) break;
    }
    if (!complete)
      throw new Error('Connector snapshot sayfa sınırında tamamlanamadı.');
    if (rows.length)
      await importCatalog(db, {
        schemaVersion: 1,
        runId: randomUUID(),
        merchantId: job.merchantId,
        connectionId: job.connectionId,
        observedAt: latestSourceTime ?? latestFetchedAt,
        rows,
      });

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
            externalIds.size
              ? and(scope, notInArray(offers.externalId, [...externalIds]))
              : scope,
          );
      }
      await tx
        .update(connections)
        .set({
          authorizationStatus: 'active',
          syncCursor: null,
          lastSuccessfulSyncAt: new Date(latestSourceTime ?? latestFetchedAt),
          lastFetchedAt: new Date(latestFetchedAt),
          lastSyncError: null,
        })
        .where(eq(connections.id, job.connectionId));
    });
    return {
      skipped: false,
      imported: rows.length,
      complete,
      mode: connection.effectiveSyncMode,
    } as const;
  } catch (error) {
    const message =
      error instanceof Error ? error.message.slice(0, 1000) : 'Senkron hatası';
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
    throw error;
  }
}
