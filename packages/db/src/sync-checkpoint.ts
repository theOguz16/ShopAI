import { and, desc, eq, gt, ne, sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import type { Database } from './client.js';
import { connections, importRuns } from './schema.js';
import { setTenantContext } from './tenant-context.js';

const at = (name: string) =>
  timestamp(name, { withTimezone: true, mode: 'date' });

/**
 * Durable per-run sync checkpoint. The cursor column only ever advances in the
 * same transaction that committed the corresponding catalog chunk, so a crash
 * leaves the checkpoint pointing at the first uncommitted page. It stores
 * references and counters exclusively: no credential and no catalog payload.
 */
export const syncRunCheckpoints = pgTable(
  'sync_run_checkpoints',
  {
    merchantId: uuid('merchant_id').notNull(),
    connectionId: uuid('connection_id').notNull(),
    syncRunId: uuid('sync_run_id').notNull(),
    status: text('status').notNull().default('running'),
    cursor: text('cursor'),
    pages: bigint('pages', { mode: 'number' }).notNull().default(0),
    chunks: bigint('chunks', { mode: 'number' }).notNull().default(0),
    rowsProcessed: bigint('rows_processed', { mode: 'number' })
      .notNull()
      .default(0),
    productsProcessed: bigint('products_processed', { mode: 'number' })
      .notNull()
      .default(0),
    variantsProcessed: bigint('variants_processed', { mode: 'number' })
      .notNull()
      .default(0),
    rejectedRows: bigint('rejected_rows', { mode: 'number' })
      .notNull()
      .default(0),
    attempts: bigint('attempts', { mode: 'number' }).notNull().default(1),
    /** True once the source-declared final page has been committed. */
    sourceComplete: boolean('source_complete').notNull().default(false),
    observedAt: at('observed_at').notNull(),
    maxSourceObservedAt: at('max_source_observed_at'),
    startedAt: at('started_at').notNull(),
    completedAt: at('completed_at'),
    updatedAt: at('updated_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({
      columns: [t.merchantId, t.connectionId, t.syncRunId],
      name: 'sync_run_checkpoints_pk',
    }),
    foreignKey({
      columns: [t.merchantId, t.connectionId],
      foreignColumns: [connections.merchantId, connections.id],
    }).onDelete('cascade'),
    check(
      'sync_run_checkpoints_status',
      sql`${t.status} in ('running','completed','failed')`,
    ),
    check(
      'sync_run_checkpoints_counts',
      sql`${t.pages} >= 0 and ${t.chunks} >= 0 and ${t.rowsProcessed} >= 0 and ${t.productsProcessed} >= 0 and ${t.variantsProcessed} >= 0 and ${t.rejectedRows} >= 0 and ${t.attempts} >= 0`,
    ),
    index('sync_run_checkpoints_connection_status').on(
      t.connectionId,
      t.status,
      t.updatedAt,
    ),
  ],
);

/**
 * A second live run for the same connection within this heartbeat window is
 * treated as concurrent and skipped instead of racing it chunk-by-chunk.
 */
export const ACTIVE_SYNC_HEARTBEAT_MS = 30 * 60 * 1000;

export type SyncRunCheckpointState = {
  cursor: string | null;
  pages: number;
  chunks: number;
  rowsProcessed: number;
  productsProcessed: number;
  variantsProcessed: number;
  rejectedRows: number;
  sourceComplete: boolean;
  maxSourceObservedAt: string | null;
};

export type BeginSyncRunInput = {
  merchantId: string;
  connectionId: string;
  syncRunId: string;
  /** Desired run observation time; a fresh run never observes before the last source watermark. */
  desiredObservedAt: Date;
  startedAt: Date;
};

export type BeginSyncRunResult =
  | {
      kind: 'started';
      state: SyncRunCheckpointState;
      observedAt: Date;
      startedAt: Date;
    }
  | {
      kind: 'resumed';
      state: SyncRunCheckpointState;
      observedAt: Date;
      startedAt: Date;
    }
  | { kind: 'skipped-concurrent' }
  | { kind: 'skipped-duplicate' }
  | { kind: 'skipped-stale'; newerObservedAt: Date };

type SyncCheckpointTx = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Guard + resume entry point for one sync attempt. Runs the concurrency guard
 * (recent live checkpoint from another run), the duplicate guard (run already
 * completed), the staleness guard (a newer run already imported for this
 * connection) and reuses the stored cursor/counters for resume.
 */
export async function beginSyncRun(
  db: Database,
  input: BeginSyncRunInput,
): Promise<BeginSyncRunResult> {
  return db.transaction(async (tx) => {
    await setTenantContext(tx, input.merchantId);
    const [concurrent] = await tx
      .select({ syncRunId: syncRunCheckpoints.syncRunId })
      .from(syncRunCheckpoints)
      .where(
        and(
          eq(syncRunCheckpoints.connectionId, input.connectionId),
          ne(syncRunCheckpoints.syncRunId, input.syncRunId),
          eq(syncRunCheckpoints.status, 'running'),
          gt(
            syncRunCheckpoints.updatedAt,
            new Date(Date.now() - ACTIVE_SYNC_HEARTBEAT_MS),
          ),
        ),
      )
      .limit(1);
    if (concurrent) return { kind: 'skipped-concurrent' };

    const [connection] = await tx
      .select({ watermarkAt: connections.lastSourceWatermarkAt })
      .from(connections)
      .where(
        and(
          eq(connections.id, input.connectionId),
          eq(connections.merchantId, input.merchantId),
        ),
      )
      .limit(1);
    const [existing] = await tx
      .select()
      .from(syncRunCheckpoints)
      .where(
        and(
          eq(syncRunCheckpoints.merchantId, input.merchantId),
          eq(syncRunCheckpoints.connectionId, input.connectionId),
          eq(syncRunCheckpoints.syncRunId, input.syncRunId),
        ),
      )
      .limit(1);
    const [runRow] = await tx
      .select({ status: importRuns.status })
      .from(importRuns)
      .where(
        and(
          eq(importRuns.id, input.syncRunId),
          eq(importRuns.merchantId, input.merchantId),
        ),
      )
      .limit(1);
    if (runRow?.status === 'completed' && !existing) {
      // A run row completed without a checkpoint (legacy/finalized run): a
      // duplicate delivery must not re-import.
      return { kind: 'skipped-duplicate' };
    }
    if (runRow?.status === 'completed' && existing?.status === 'completed') {
      return { kind: 'skipped-duplicate' };
    }

    if (existing) {
      await tx
        .update(syncRunCheckpoints)
        .set({
          status: 'running',
          attempts: existing.attempts + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(syncRunCheckpoints.merchantId, input.merchantId),
            eq(syncRunCheckpoints.connectionId, input.connectionId),
            eq(syncRunCheckpoints.syncRunId, input.syncRunId),
          ),
        );
    } else {
      // A fresh run never observes earlier than the last source watermark:
      // source clocks can sit ahead of the worker clock and the run observation
      // time must stay monotonic per connection.
      const observedAt = new Date(
        Math.max(
          input.desiredObservedAt.getTime(),
          connection?.watermarkAt?.getTime() ?? 0,
        ),
      );
      const [latestOther] = await tx
        .select({ observedAt: importRuns.observedAt })
        .from(importRuns)
        .where(
          and(
            eq(importRuns.connectionId, input.connectionId),
            ne(importRuns.id, input.syncRunId),
          ),
        )
        .orderBy(desc(importRuns.observedAt))
        .limit(1);
      if (latestOther && latestOther.observedAt > observedAt) {
        return {
          kind: 'skipped-stale',
          newerObservedAt: latestOther.observedAt,
        };
      }
      await tx.insert(syncRunCheckpoints).values({
        merchantId: input.merchantId,
        connectionId: input.connectionId,
        syncRunId: input.syncRunId,
        status: 'running',
        cursor: null,
        attempts: 1,
        observedAt,
        startedAt: input.startedAt,
      });
      await tx.insert(importRuns).values({
        id: input.syncRunId,
        merchantId: input.merchantId,
        connectionId: input.connectionId,
        rows: 0,
        observedAt,
        status: 'processing',
        filePath: '',
        error: null,
      });
    }

    if (existing) {
      await tx
        .insert(importRuns)
        .values({
          id: input.syncRunId,
          merchantId: input.merchantId,
          connectionId: input.connectionId,
          rows: 0,
          observedAt: existing.observedAt,
          status: 'processing',
          filePath: '',
          error: null,
        })
        .onConflictDoUpdate({
          target: importRuns.id,
          set: { status: 'processing', error: null, completedAt: null },
        });
    }

    const [state] = await tx
      .select()
      .from(syncRunCheckpoints)
      .where(
        and(
          eq(syncRunCheckpoints.merchantId, input.merchantId),
          eq(syncRunCheckpoints.connectionId, input.connectionId),
          eq(syncRunCheckpoints.syncRunId, input.syncRunId),
        ),
      )
      .limit(1);
    if (!state) throw new Error('Sync checkpoint oluşturulamadı.');
    return {
      kind: existing ? 'resumed' : 'started',
      state: {
        cursor: state.cursor,
        pages: state.pages,
        chunks: state.chunks,
        rowsProcessed: state.rowsProcessed,
        productsProcessed: state.productsProcessed,
        variantsProcessed: state.variantsProcessed,
        rejectedRows: state.rejectedRows,
        sourceComplete: state.sourceComplete,
        maxSourceObservedAt: state.maxSourceObservedAt?.toISOString() ?? null,
      },
      observedAt: state.observedAt,
      startedAt: state.startedAt,
    };
  });
}

/**
 * Checkpoint advance. MUST be called inside the import transaction of the
 * chunk it follows: the cursor and counters become durable exactly when the
 * chunk commits and never before it.
 */
export async function upsertSyncCheckpoint(
  tx: SyncCheckpointTx,
  input: {
    merchantId: string;
    connectionId: string;
    syncRunId: string;
    state: SyncRunCheckpointState;
    observedAt: Date;
    startedAt: Date;
  },
) {
  await tx
    .insert(syncRunCheckpoints)
    .values({
      merchantId: input.merchantId,
      connectionId: input.connectionId,
      syncRunId: input.syncRunId,
      status: 'running',
      cursor: input.state.cursor,
      pages: input.state.pages,
      chunks: input.state.chunks,
      rowsProcessed: input.state.rowsProcessed,
      productsProcessed: input.state.productsProcessed,
      variantsProcessed: input.state.variantsProcessed,
      rejectedRows: input.state.rejectedRows,
      sourceComplete: input.state.sourceComplete,
      maxSourceObservedAt: input.state.maxSourceObservedAt
        ? new Date(input.state.maxSourceObservedAt)
        : null,
      observedAt: input.observedAt,
      startedAt: input.startedAt,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [
        syncRunCheckpoints.merchantId,
        syncRunCheckpoints.connectionId,
        syncRunCheckpoints.syncRunId,
      ],
      set: {
        cursor: input.state.cursor,
        pages: input.state.pages,
        chunks: input.state.chunks,
        rowsProcessed: input.state.rowsProcessed,
        productsProcessed: input.state.productsProcessed,
        variantsProcessed: input.state.variantsProcessed,
        rejectedRows: input.state.rejectedRows,
        sourceComplete: input.state.sourceComplete,
        maxSourceObservedAt: input.state.maxSourceObservedAt
          ? new Date(input.state.maxSourceObservedAt)
          : null,
        updatedAt: new Date(),
      },
    });
}

/**
 * Completion bookkeeping for a finished run. Called inside the finalization
 * transaction so the completed checkpoint, the cumulative import run record
 * and any run-scoped writes commit atomically.
 */
export async function markSyncRunCompleted(
  tx: SyncCheckpointTx,
  input: {
    merchantId: string;
    connectionId: string;
    syncRunId: string;
    state: SyncRunCheckpointState;
    observedAt: Date;
    startedAt: Date;
    totalRows: number;
    completedAt: Date;
  },
) {
  await upsertSyncCheckpoint(tx, {
    merchantId: input.merchantId,
    connectionId: input.connectionId,
    syncRunId: input.syncRunId,
    state: input.state,
    observedAt: input.observedAt,
    startedAt: input.startedAt,
  });
  await tx
    .update(syncRunCheckpoints)
    .set({ status: 'completed', completedAt: input.completedAt })
    .where(
      and(
        eq(syncRunCheckpoints.merchantId, input.merchantId),
        eq(syncRunCheckpoints.connectionId, input.connectionId),
        eq(syncRunCheckpoints.syncRunId, input.syncRunId),
      ),
    );
  await tx
    .insert(importRuns)
    .values({
      id: input.syncRunId,
      merchantId: input.merchantId,
      connectionId: input.connectionId,
      rows: input.totalRows,
      observedAt: input.observedAt,
      status: 'completed',
      filePath: '',
      completedAt: input.completedAt,
      error: null,
    })
    .onConflictDoUpdate({
      target: importRuns.id,
      set: {
        rows: input.totalRows,
        status: 'completed',
        completedAt: input.completedAt,
        error: null,
      },
    });
}

/** Marks a run failed after its last committed checkpoint (cursor stays behind). */ export async function markSyncRunFailed(
  db: Database,
  input: {
    merchantId: string;
    connectionId: string;
    syncRunId: string;
    error: string;
  },
) {
  return db.transaction(async (tx) => {
    await setTenantContext(tx, input.merchantId);
    await tx
      .update(syncRunCheckpoints)
      .set({ status: 'failed', updatedAt: new Date() })
      .where(
        and(
          eq(syncRunCheckpoints.merchantId, input.merchantId),
          eq(syncRunCheckpoints.connectionId, input.connectionId),
          eq(syncRunCheckpoints.syncRunId, input.syncRunId),
        ),
      );
    await tx
      .update(importRuns)
      .set({
        status: 'failed',
        error: { message: input.error.slice(0, 500) },
        completedAt: new Date(),
      })
      .where(
        and(
          eq(importRuns.id, input.syncRunId),
          eq(importRuns.merchantId, input.merchantId),
        ),
      );
  });
}
