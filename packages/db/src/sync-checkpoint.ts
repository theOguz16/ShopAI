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
 * Connection-scoped sync lease. Exactly one run may own a connection's
 * catalog sync at a time; acquisition is atomic (INSERT ... ON CONFLICT DO
 * NOTHING followed by SELECT ... FOR UPDATE in one transaction) and every
 * catalog-mutating transaction must re-prove ownership plus the fencing
 * token, so a stalled runner that lost its lease can never write again.
 */
export const syncConnectionLeases = pgTable(
  'sync_connection_leases',
  {
    merchantId: uuid('merchant_id').notNull(),
    connectionId: uuid('connection_id').primaryKey(),
    ownerSyncRunId: uuid('owner_sync_run_id').notNull(),
    fencingToken: bigint('fencing_token', { mode: 'number' }).notNull(),
    leaseExpiresAt: at('lease_expires_at').notNull(),
    updatedAt: at('updated_at').notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.merchantId, t.connectionId],
      foreignColumns: [connections.merchantId, connections.id],
    }).onDelete('cascade'),
    check('sync_connection_leases_token', sql`${t.fencingToken} >= 0`),
  ],
);

/**
 * Lease TTL bounds only stale-run recovery. Active runners renew on every
 * committed chunk/page, so a long healthy sync is never handed to a second
 * runner by age alone.
 */
export const SYNC_LEASE_DURATION_MS = 30 * 60 * 1000;

/** Thrown when a runner that lost its lease attempts a catalog mutation. */
export class SyncLeaseLostError extends Error {
  constructor() {
    super('Sync lease kaybedildi (fenced).');
    this.name = 'SyncLeaseLostError';
  }
}

export type SyncLease = { fencingToken: number };

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
  /** Lease evaluation clock; controllable for race/staleness tests. */
  now: Date;
};

export type BeginSyncRunResult =
  | {
      kind: 'started';
      state: SyncRunCheckpointState;
      observedAt: Date;
      startedAt: Date;
      lease: SyncLease;
    }
  | {
      kind: 'resumed';
      state: SyncRunCheckpointState;
      observedAt: Date;
      startedAt: Date;
      lease: SyncLease;
    }
  | { kind: 'skipped-concurrent' }
  | { kind: 'skipped-duplicate' }
  | { kind: 'skipped-stale'; newerObservedAt: Date };

type SyncCheckpointTx = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Atomic lease acquisition. The INSERT ... ON CONFLICT DO NOTHING plus
 * SELECT ... FOR UPDATE chain serializes concurrent acquisitions in one
 * transaction: exactly one of two simultaneous fresh runs can see itself as
 * the unexpired owner. An expired foreign lease is taken over with a bumped
 * fencing token and the previous owner's checkpoint is failed in the same
 * transaction.
 */
async function acquireSyncLease(
  tx: SyncCheckpointTx,
  input: {
    merchantId: string;
    connectionId: string;
    syncRunId: string;
    now: Date;
  },
): Promise<{ acquired: boolean; lease: SyncLease }> {
  const expiresAt = new Date(input.now.getTime() + SYNC_LEASE_DURATION_MS);
  const inserted = await tx
    .insert(syncConnectionLeases)
    .values({
      merchantId: input.merchantId,
      connectionId: input.connectionId,
      ownerSyncRunId: input.syncRunId,
      fencingToken: 0,
      leaseExpiresAt: expiresAt,
      updatedAt: input.now,
    })
    .onConflictDoNothing({ target: syncConnectionLeases.connectionId })
    .returning({ connectionId: syncConnectionLeases.connectionId });
  const [lease] = await tx
    .select()
    .from(syncConnectionLeases)
    .where(eq(syncConnectionLeases.connectionId, input.connectionId))
    .limit(1)
    .for('update');
  if (!lease) throw new Error('Sync lease oluşturulamadı.');
  if (lease.merchantId !== input.merchantId)
    throw new Error('Sync lease kapsam dışı.');

  if (inserted.length)
    return { acquired: true, lease: { fencingToken: lease.fencingToken } };

  if (lease.leaseExpiresAt > input.now)
    return { acquired: false, lease: { fencingToken: lease.fencingToken } };

  // Stale takeover, including a second attempt for the same run ID: bump the
  // token so the previous attempt's next catalog write is fenced.
  const fencingToken = lease.fencingToken + 1;
  await tx
    .update(syncConnectionLeases)
    .set({
      ownerSyncRunId: input.syncRunId,
      fencingToken,
      leaseExpiresAt: expiresAt,
      updatedAt: input.now,
    })
    .where(eq(syncConnectionLeases.connectionId, input.connectionId));
  if (lease.ownerSyncRunId !== input.syncRunId) {
    await tx
      .update(syncRunCheckpoints)
      .set({ status: 'failed', updatedAt: input.now })
      .where(
        and(
          eq(syncRunCheckpoints.merchantId, input.merchantId),
          eq(syncRunCheckpoints.connectionId, input.connectionId),
          eq(syncRunCheckpoints.syncRunId, lease.ownerSyncRunId),
          eq(syncRunCheckpoints.status, 'running'),
        ),
      );
    await tx
      .update(importRuns)
      .set({
        status: 'failed',
        error: { message: 'Superseded by a newer sync run takeover.' },
        completedAt: input.now,
      })
      .where(
        and(
          eq(importRuns.id, lease.ownerSyncRunId),
          eq(importRuns.merchantId, input.merchantId),
          eq(importRuns.connectionId, input.connectionId),
          eq(importRuns.status, 'processing'),
        ),
      );
  }
  return { acquired: true, lease: { fencingToken } };
}

/**
 * Fencing proof + heartbeat. Extends the lease ONLY for the current owner
 * with the exact fencing token; any other state throws SyncLeaseLostError so
 * the surrounding catalog transaction aborts. Safe to call regardless of
 * expiry: a foreign takeover always changes the owner first.
 */
export async function renewSyncLease(
  tx: SyncCheckpointTx,
  input: {
    merchantId: string;
    connectionId: string;
    syncRunId: string;
    fencingToken: number;
    now: Date;
  },
): Promise<void> {
  const expiresAt = new Date(input.now.getTime() + SYNC_LEASE_DURATION_MS);
  const renewed = await tx
    .update(syncConnectionLeases)
    .set({ leaseExpiresAt: expiresAt, updatedAt: input.now })
    .where(
      and(
        eq(syncConnectionLeases.connectionId, input.connectionId),
        eq(syncConnectionLeases.merchantId, input.merchantId),
        eq(syncConnectionLeases.ownerSyncRunId, input.syncRunId),
        eq(syncConnectionLeases.fencingToken, input.fencingToken),
      ),
    )
    .returning({ id: syncConnectionLeases.connectionId });
  if (!renewed.length) throw new SyncLeaseLostError();
}

/** Releases ownership at once (expiry = now); token history stays for the next takeover. */
export async function releaseSyncLease(
  tx: SyncCheckpointTx,
  input: {
    merchantId: string;
    connectionId: string;
    syncRunId: string;
    fencingToken: number;
    now: Date;
  },
): Promise<void> {
  await tx
    .update(syncConnectionLeases)
    .set({ leaseExpiresAt: input.now, updatedAt: input.now })
    .where(
      and(
        eq(syncConnectionLeases.connectionId, input.connectionId),
        eq(syncConnectionLeases.merchantId, input.merchantId),
        eq(syncConnectionLeases.ownerSyncRunId, input.syncRunId),
        eq(syncConnectionLeases.fencingToken, input.fencingToken),
      ),
    );
}

/**
 * Guard + resume entry point for one sync attempt. Acquires the
 * connection-scoped lease atomically, applies the duplicate/staleness guards
 * and reuses the stored cursor/counters for resume.
 */
export async function beginSyncRun(
  db: Database,
  input: BeginSyncRunInput,
): Promise<BeginSyncRunResult> {
  return db.transaction(async (tx) => {
    await setTenantContext(tx, input.merchantId);
    let [existing] = await tx
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

    const claim = await acquireSyncLease(tx, {
      merchantId: input.merchantId,
      connectionId: input.connectionId,
      syncRunId: input.syncRunId,
      now: input.now,
    });
    if (!claim.acquired) return { kind: 'skipped-concurrent' };

    // The first read precedes the lease lock. Re-read after acquisition so a
    // concurrent finalizer cannot turn a duplicate delivery into a resume.
    [existing] = await tx
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
    if (existing?.status === 'completed') {
      await releaseSyncLease(tx, {
        ...input,
        fencingToken: claim.lease.fencingToken,
      });
      return { kind: 'skipped-duplicate' };
    }

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

    if (existing) {
      const [newerCompleted] = await tx
        .select({ id: importRuns.id })
        .from(importRuns)
        .where(
          and(
            eq(importRuns.merchantId, input.merchantId),
            eq(importRuns.connectionId, input.connectionId),
            ne(importRuns.id, input.syncRunId),
            eq(importRuns.status, 'completed'),
            gt(importRuns.completedAt, existing.startedAt),
          ),
        )
        .limit(1);
      if (newerCompleted) {
        await releaseSyncLease(tx, {
          ...input,
          fencingToken: claim.lease.fencingToken,
        });
        return {
          kind: 'skipped-stale',
          newerObservedAt: connection?.watermarkAt ?? input.now,
        };
      }
      await tx
        .update(syncRunCheckpoints)
        .set({
          status: 'running',
          attempts: existing.attempts + 1,
          updatedAt: input.now,
        })
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
        await releaseSyncLease(tx, {
          ...input,
          fencingToken: claim.lease.fencingToken,
        });
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
      lease: claim.lease,
    };
  });
}

/**
 * Checkpoint advance, fenced: proves lease ownership inside the same
 * transaction (renewing the lease), so a stale runner can never move its
 * cursor after a takeover.
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
    fencingToken: number;
    now: Date;
  },
) {
  await renewSyncLease(tx, {
    merchantId: input.merchantId,
    connectionId: input.connectionId,
    syncRunId: input.syncRunId,
    fencingToken: input.fencingToken,
    now: input.now,
  });
  await writeCheckpointRow(tx, { ...input, now: input.now });
}

/**
 * Completion bookkeeping for a finished run. The lease is proven first —
 * a stale runner cannot complete, watermark or deactivate offers — and the
 * cumulative import run record commits atomically with the final checkpoint.
 * The lease is released at the end of the same transaction.
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
    fencingToken: number;
  },
) {
  await renewSyncLease(tx, {
    merchantId: input.merchantId,
    connectionId: input.connectionId,
    syncRunId: input.syncRunId,
    fencingToken: input.fencingToken,
    now: input.completedAt,
  });
  await writeCheckpointRow(tx, input);
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
  await releaseSyncLease(tx, {
    merchantId: input.merchantId,
    connectionId: input.connectionId,
    syncRunId: input.syncRunId,
    fencingToken: input.fencingToken,
    now: input.completedAt,
  });
}

/** Raw checkpoint row write; callers provide the fence proof. */
async function writeCheckpointRow(
  tx: SyncCheckpointTx,
  input: {
    merchantId: string;
    connectionId: string;
    syncRunId: string;
    state: SyncRunCheckpointState;
    observedAt: Date;
    startedAt: Date;
    now?: Date;
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
      updatedAt: input.now ?? new Date(),
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
        updatedAt: input.now ?? new Date(),
      },
    });
}

/**
 * Marks a run failed after its last committed checkpoint (cursor stays
 * behind) and releases the lease if this run still owns it. Fenced runs may
 * still record their own failure; they just cannot mutate the catalog.
 */
export async function markSyncRunFailed(
  db: Database,
  input: {
    merchantId: string;
    connectionId: string;
    syncRunId: string;
    error: string;
    fencingToken?: number;
    now?: Date;
    reauthorizationRequired?: boolean;
  },
) {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    await setTenantContext(tx, input.merchantId);
    if (input.fencingToken !== undefined) {
      const [lease] = await tx
        .select({
          ownerSyncRunId: syncConnectionLeases.ownerSyncRunId,
          fencingToken: syncConnectionLeases.fencingToken,
        })
        .from(syncConnectionLeases)
        .where(
          and(
            eq(syncConnectionLeases.merchantId, input.merchantId),
            eq(syncConnectionLeases.connectionId, input.connectionId),
          ),
        )
        .for('update');
      // A second attempt may have taken over the same syncRunId. Its
      // checkpoint/import run are shared, so the old attempt must leave them
      // untouched as well as avoiding connection writes.
      if (
        lease?.ownerSyncRunId !== input.syncRunId ||
        lease.fencingToken !== input.fencingToken
      )
        return;
      await tx
        .update(connections)
        .set({
          lastSyncError: input.error.slice(0, 500),
          ...(input.reauthorizationRequired
            ? { authorizationStatus: 'reauthorization_required' }
            : {}),
        })
        .where(
          and(
            eq(connections.merchantId, input.merchantId),
            eq(connections.id, input.connectionId),
          ),
        );
    }
    await tx
      .update(syncRunCheckpoints)
      .set({ status: 'failed', updatedAt: now })
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
        completedAt: now,
      })
      .where(
        and(
          eq(importRuns.id, input.syncRunId),
          eq(importRuns.merchantId, input.merchantId),
        ),
      );
    if (input.fencingToken !== undefined) {
      await releaseSyncLease(tx, {
        merchantId: input.merchantId,
        connectionId: input.connectionId,
        syncRunId: input.syncRunId,
        fencingToken: input.fencingToken,
        now,
      });
    }
  });
}
