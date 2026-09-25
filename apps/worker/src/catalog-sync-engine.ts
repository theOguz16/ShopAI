import {
  catalogSyncFailureStatus,
  type CatalogSyncProgress,
} from '@shopai/commerce';
import type { LiveCatalogConnector } from '@shopai/connectors';
import type { SourceRow, SyncJob } from '@shopai/contracts';
import {
  beginSyncRun,
  type Database,
  importCatalog,
  markSyncRunCompleted,
  markSyncRunFailed,
  setTenantContext,
  type SyncRunCheckpointState,
  upsertSyncCheckpoint,
  writeConnectionSyncProgress,
} from '@shopai/db';
import { and, eq, ne, or, sql } from 'drizzle-orm';
import { connections, offers } from '@shopai/db';
import {
  createCatalogCounters,
  iterateCatalogPages,
  MAX_CATALOG_PAGES,
  observePage,
  progressFromCounters,
} from './catalog-pages.js';

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

export type CatalogSyncCounters = SyncRunCheckpointState & {
  /** Cumulative rows across fetched pages (committed + current page). */
  rowsSeen: number;
  /** Cumulative distinct product keys across fetched pages. */
  productsSeen: number;
};

export type CatalogSyncEngineInput = {
  db: Database;
  job: SyncJob;
  syncRunId: string;
  connector: Pick<LiveCatalogConnector, 'readPage'>;
  mode: 'full' | 'incremental';
  modifiedAfter: string | null;
  credentialsRef: string;
  batchSize?: number;
  maxPages?: number;
  now?: () => Date;
  onProgress?: (progress: CatalogSyncProgress) => Promise<void> | void;
  /** Observability seam: fires after each chunk commits, before the next fetch. */
  onChunkCommitted?: (info: {
    chunks: number;
    rowsProcessed: number;
    productsProcessed: number;
  }) => Promise<void> | void;
};

export type CatalogSyncEngineResult =
  | {
      kind: 'skipped';
      reason: 'concurrent-sync' | 'duplicate-run' | 'stale-run';
    }
  | {
      kind: 'completed';
      imported: number;
      mode: 'full' | 'incremental';
      observedAt: Date;
      startedAt: Date;
      completedAt: Date;
      counters: CatalogSyncCounters;
    };

/**
 * Bounded-memory catalog sync: fetch page → normalize/validate → upsert chunk
 * → checkpoint (same transaction) → release → next page. No stage ever holds
 * the whole catalog; the only cross-chunk state is the checkpoint record and
 * an O(maxPages) cursor-loop set.
 */
export async function runCatalogSyncEngine(
  input: CatalogSyncEngineInput,
): Promise<CatalogSyncEngineResult> {
  const { db, job, syncRunId, connector, mode, modifiedAfter, credentialsRef } =
    input;
  const now = input.now ?? (() => new Date());
  const batchSize = input.batchSize ?? CATALOG_IMPORT_BATCH_SIZE;
  const startedAt = now();

  const begin = await beginSyncRun(db, {
    merchantId: job.merchantId,
    connectionId: job.connectionId,
    syncRunId,
    desiredObservedAt: startedAt,
    startedAt,
  });
  if (begin.kind === 'skipped-concurrent')
    return { kind: 'skipped', reason: 'concurrent-sync' };
  if (begin.kind === 'skipped-duplicate')
    return { kind: 'skipped', reason: 'duplicate-run' };
  if (begin.kind === 'skipped-stale')
    return { kind: 'skipped', reason: 'stale-run' };

  const counters: CatalogSyncCounters = {
    cursor: begin.state.cursor,
    pages: begin.state.pages,
    chunks: begin.state.chunks,
    rowsProcessed: begin.state.rowsProcessed,
    productsProcessed: begin.state.productsProcessed,
    variantsProcessed: begin.state.variantsProcessed,
    rejectedRows: begin.state.rejectedRows,
    sourceComplete: begin.state.sourceComplete,
    maxSourceObservedAt: begin.state.maxSourceObservedAt,
    rowsSeen: begin.state.variantsProcessed,
    productsSeen: begin.state.productsProcessed,
  };
  const observedAt = begin.observedAt;
  const runStartedAt = begin.startedAt;

  let progress = currentProgress(counters, begin.state.sourceComplete);
  let latestFetchedAt = now();
  try {
    await writeConnectionSyncProgress(
      db,
      job.merchantId,
      job.connectionId,
      { ...progress, startedAt: runStartedAt, completedAt: null, error: null },
      now(),
    );

    // Resume of an already fully-committed run: skip the fetch loop and go
    // straight to finalization (crash between last commit and completion).
    if (!(begin.state.cursor === null && begin.state.pages > 0)) {
      for await (const page of iterateCatalogPages({
        connector,
        mode,
        modifiedAfter,
        startCursor: begin.state.cursor,
        maxPages: input.maxPages ?? MAX_CATALOG_PAGES,
      })) {
        latestFetchedAt = new Date(page.fetchedAt);
        const midStreamEmptyPage = Boolean(page.nextCursor) || !page.complete;
        if (counters.cursor && !page.rows.length && midStreamEmptyPage)
          throw new Error(
            `Connector sayfa cursor'ı ${counters.cursor} için boş sayfa döndü.`,
          );
        const pageExternalIds = new Set(page.rows.map((row) => row.externalId));
        if (pageExternalIds.size !== page.rows.length)
          throw new Error(
            'Aynı source externalId bir connector sayfasında tekrar edemez.',
          );
        observePage(counters, page);
        const pageIsFinal = page.complete && !page.nextCursor;
        counters.cursor = page.nextCursor;
        const batches = chunkCatalogRows(page.rows, batchSize);
        for (const rows of batches) {
          const chunkRows = rows.length;
          const chunkProducts = distinctProductKeys(rows);
          await importCatalog(
            db,
            {
              schemaVersion: 1,
              runId: syncRunId,
              merchantId: job.merchantId,
              connectionId: job.connectionId,
              observedAt: observedAt.toISOString(),
              rows,
            },
            // The sync run finalizer owns the import_runs record; each chunk
            // must not complete it.
            { finalizeRun: false },
          );
          counters.chunks += 1;
          counters.rowsProcessed += chunkRows;
          counters.variantsProcessed += chunkRows;
          counters.productsProcessed += chunkProducts;
          if (input.onChunkCommitted)
            await input.onChunkCommitted({
              chunks: counters.chunks,
              rowsProcessed: counters.rowsProcessed,
              productsProcessed: counters.productsProcessed,
            });
          progress = currentProgress(counters, false);
          await writeConnectionSyncProgress(
            db,
            job.merchantId,
            job.connectionId,
            {
              ...progress,
              startedAt: runStartedAt,
              completedAt: null,
              error: null,
            },
            now(),
          );
        }
        // The durable cursor advances only after every chunk of the page has
        // committed: a crash replays at most one page, idempotently.
        counters.sourceComplete = pageIsFinal;
        await persistCheckpoint(db, job, syncRunId, counters, {
          observedAt,
          startedAt: runStartedAt,
        });
      }
      if (!counters.sourceComplete)
        throw new Error('Connector snapshot sayfa sınırında tamamlanamadı.');
    }

    const completedAt = now();
    const totalRows = counters.rowsProcessed;
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
        live.credentialsRef !== credentialsRef
      )
        throw new Error('Connection changed during sync.');
      if (mode === 'full') {
        // Exact streamed replacement for the old snapshot-wide NOT IN query:
        // every offer this run did not observe is deactivated.
        await tx
          .update(offers)
          .set({ active: false })
          .where(
            and(
              eq(offers.connectionId, job.connectionId),
              eq(offers.merchantId, job.merchantId),
              eq(offers.active, true),
              or(
                sql`${offers.lastSyncRunId} is null`,
                ne(offers.lastSyncRunId, syncRunId),
              ),
            ),
          );
      }
      await tx
        .update(connections)
        .set({
          authorizationStatus: 'active',
          syncCursor: null,
          lastSourceWatermarkAt: counters.maxSourceObservedAt
            ? new Date(counters.maxSourceObservedAt)
            : undefined,
          lastSuccessfulSyncAt: completedAt,
          lastFetchedAt: latestFetchedAt,
          lastSyncError: null,
        })
        .where(
          and(
            eq(connections.id, job.connectionId),
            eq(connections.active, true),
          ),
        );
      await markSyncRunCompleted(tx, {
        merchantId: job.merchantId,
        connectionId: job.connectionId,
        syncRunId,
        state: counters,
        observedAt,
        startedAt: runStartedAt,
        totalRows,
        completedAt,
      });
    });

    progress = {
      status: 'completed',
      foundProducts: counters.productsSeen,
      processedProducts: counters.productsSeen,
      failedProducts: 0,
      variants: counters.rowsSeen,
    };
    await writeConnectionSyncProgress(
      db,
      job.merchantId,
      job.connectionId,
      { ...progress, startedAt: runStartedAt, completedAt, error: null },
      completedAt,
    );

    return {
      kind: 'completed',
      imported: totalRows,
      mode,
      observedAt,
      startedAt: runStartedAt,
      completedAt,
      counters,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Catalog sync failed';
    await markSyncRunFailed(db, {
      merchantId: job.merchantId,
      connectionId: job.connectionId,
      syncRunId,
      error: message,
    });
    const failedAt = now();
    await writeConnectionSyncProgress(
      db,
      job.merchantId,
      job.connectionId,
      {
        status: catalogSyncFailureStatus(progress),
        foundProducts: progress.foundProducts,
        processedProducts: progress.processedProducts,
        failedProducts: progress.failedProducts,
        variants: progress.variants,
        startedAt: runStartedAt,
        completedAt: failedAt,
        error: message,
      },
      failedAt,
    );
    throw error;
  }
}

function currentProgress(
  counters: CatalogSyncCounters,
  complete: boolean,
): CatalogSyncProgress {
  const progress = progressFromCounters(
    {
      pages: counters.pages,
      rowsSeen: counters.rowsSeen,
      productsSeen: counters.productsSeen,
      maxSourceObservedAt: counters.maxSourceObservedAt,
    },
    counters.productsProcessed,
  );
  return complete
    ? {
        ...progress,
        processedProducts: progress.foundProducts,
        failedProducts: 0,
      }
    : progress;
}

async function persistCheckpoint(
  db: Database,
  job: SyncJob,
  syncRunId: string,
  counters: CatalogSyncCounters,
  timing: { observedAt: Date; startedAt: Date },
) {
  return db.transaction(async (tx) => {
    await setTenantContext(tx, job.merchantId);
    await upsertSyncCheckpoint(tx, {
      merchantId: job.merchantId,
      connectionId: job.connectionId,
      syncRunId,
      state: counters,
      observedAt: timing.observedAt,
      startedAt: timing.startedAt,
    });
  });
}

function distinctProductKeys(rows: SourceRow[]) {
  return new Set(rows.map((row) => row.productKey)).size;
}
