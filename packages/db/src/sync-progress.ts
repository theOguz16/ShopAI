import {
  catalogSyncFailureStatus,
  isCatalogSyncStatus,
  type CatalogSyncProgress,
  type CatalogSyncStatus,
} from '@shopai/commerce';
import { and, eq, sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import type { Database } from './client.js';
import { connections } from './schema.js';
import { setTenantContext } from './tenant-context.js';

const at = (name: string) =>
  timestamp(name, { withTimezone: true, mode: 'date' });

export const connectionSyncProgress = pgTable(
  'connection_sync_progress',
  {
    connectionId: uuid('connection_id').primaryKey(),
    merchantId: uuid('merchant_id').notNull(),
    status: text('status').notNull().default('queued'),
    foundProducts: integer('found_products').notNull().default(0),
    processedProducts: integer('processed_products').notNull().default(0),
    failedProducts: integer('failed_products').notNull().default(0),
    variants: integer('variants').notNull().default(0),
    startedAt: at('started_at'),
    completedAt: at('completed_at'),
    updatedAt: at('updated_at').notNull().defaultNow(),
    error: text('error'),
  },
  (t) => [
    foreignKey({
      columns: [t.merchantId, t.connectionId],
      foreignColumns: [connections.merchantId, connections.id],
    }),
    check(
      'connection_sync_progress_status',
      sql`${t.status} in ('queued','running','completed','partial','failed')`,
    ),
    check(
      'connection_sync_progress_counts',
      sql`${t.foundProducts} >= 0 and ${t.processedProducts} >= 0 and ${t.failedProducts} >= 0 and ${t.variants} >= 0 and ${t.processedProducts} + ${t.failedProducts} <= ${t.foundProducts}`,
    ),
    index('connection_sync_progress_merchant_updated').on(
      t.merchantId,
      t.updatedAt,
    ),
  ],
);

export type ConnectionSyncProgressView = CatalogSyncProgress & {
  connectionId: string;
  startedAt: Date | null;
  completedAt: Date | null;
  updatedAt: Date | null;
  error: string | null;
};

type ProgressWrite = CatalogSyncProgress & {
  startedAt?: Date | null;
  completedAt?: Date | null;
  error?: string | null;
};

export async function writeConnectionSyncProgress(
  db: Database,
  merchantId: string,
  connectionId: string,
  input: ProgressWrite,
  now = new Date(),
) {
  return db.transaction(async (tx) => {
    await setTenantContext(tx, merchantId);
    const [row] = await tx
      .insert(connectionSyncProgress)
      .values({
        connectionId,
        merchantId,
        status: input.status,
        foundProducts: input.foundProducts,
        processedProducts: input.processedProducts,
        failedProducts: input.failedProducts,
        variants: input.variants,
        startedAt: input.startedAt ?? null,
        completedAt: input.completedAt ?? null,
        updatedAt: now,
        error: input.error ?? null,
      })
      .onConflictDoUpdate({
        target: connectionSyncProgress.connectionId,
        set: {
          status: input.status,
          foundProducts: input.foundProducts,
          processedProducts: input.processedProducts,
          failedProducts: input.failedProducts,
          variants: input.variants,
          ...(input.startedAt !== undefined
            ? { startedAt: input.startedAt }
            : {}),
          ...(input.completedAt !== undefined
            ? { completedAt: input.completedAt }
            : {}),
          updatedAt: now,
          ...(input.error !== undefined ? { error: input.error } : {}),
        },
      })
      .returning();
    return row;
  });
}

export async function readConnectionSyncProgress(
  db: Database,
  merchantId: string,
  connectionId: string,
): Promise<ConnectionSyncProgressView | null> {
  return db.transaction(async (tx) => {
    await setTenantContext(tx, merchantId);
    const [connection] = await tx
      .select({
        id: connections.id,
        provider: connections.provider,
        authorizationStatus: connections.authorizationStatus,
        lastSyncStartedAt: connections.lastSyncStartedAt,
        lastSuccessfulSyncAt: connections.lastSuccessfulSyncAt,
        lastFetchedAt: connections.lastFetchedAt,
        lastSyncError: connections.lastSyncError,
      })
      .from(connections)
      .where(
        and(
          eq(connections.id, connectionId),
          eq(connections.merchantId, merchantId),
          eq(connections.active, true),
        ),
      );
    if (!connection) return null;

    const [progress] = await tx
      .select()
      .from(connectionSyncProgress)
      .where(
        and(
          eq(connectionSyncProgress.connectionId, connectionId),
          eq(connectionSyncProgress.merchantId, merchantId),
        ),
      );
    if (progress) {
      const status: CatalogSyncStatus = isCatalogSyncStatus(progress.status)
        ? progress.status
        : catalogSyncFailureStatus(progress);
      return {
        connectionId,
        status,
        foundProducts: progress.foundProducts,
        processedProducts: progress.processedProducts,
        failedProducts: progress.failedProducts,
        variants: progress.variants,
        startedAt: progress.startedAt,
        completedAt: progress.completedAt,
        updatedAt: progress.updatedAt,
        error: progress.error ?? connection.lastSyncError,
      };
    }

    const status: CatalogSyncStatus = connection.lastSyncError
      ? 'failed'
      : connection.provider === 'woocommerce' &&
          !connection.lastSuccessfulSyncAt &&
          connection.authorizationStatus !== 'revoked'
        ? 'queued'
        : 'completed';
    return {
      connectionId,
      status,
      foundProducts: 0,
      processedProducts: 0,
      failedProducts: 0,
      variants: 0,
      startedAt: connection.lastSyncStartedAt,
      completedAt:
        status === 'completed' ? connection.lastSuccessfulSyncAt : null,
      updatedAt:
        connection.lastFetchedAt ??
        connection.lastSyncStartedAt ??
        connection.lastSuccessfulSyncAt,
      error: connection.lastSyncError,
    };
  });
}
