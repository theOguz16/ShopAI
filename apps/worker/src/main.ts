import { IMPORT_QUEUE, SYNC_QUEUE } from '@shopai/contracts';
import {
  connections,
  createDatabase,
  importOutboxEvents,
  withWorkerRole,
} from '@shopai/db';
import { Queue, Worker } from 'bullmq';
import { and, eq, inArray, isNull, lte } from 'drizzle-orm';
import { redisConnection } from './connection.js';
import { parseWorkerEnv } from './env.js';
import { enqueueImportOutboxEvent } from './outbox.js';
import { processImportReference } from './process-import.js';
import { connectionToSyncJob } from './scheduler.js';
import { EnvironmentSecretResolver, syncCatalogConnection } from './sync.js';

const env = parseWorkerEnv(process.env);
const database = createDatabase(env.DATABASE_URL);
const operationalLog = (
  level: 'info' | 'error' | 'warn',
  event: string,
  fields: Record<string, unknown> = {},
) => {
  const entry = JSON.stringify({
    level,
    event,
    service: 'worker',
    release: env.RELEASE_VERSION,
    ...fields,
  });
  if (level === 'error') console.error(entry);
  else if (level === 'warn') console.warn(entry);
  else console.info(entry);
};
const worker = new Worker(
  IMPORT_QUEUE,
  (job) => processImportReference(database.db, job.data),
  {
    connection: {
      ...redisConnection(env.REDIS_URL),
      maxRetriesPerRequest: null,
    },
    concurrency: 2,
    lockDuration: 10 * 60 * 1000,
  },
);
const syncWorker = new Worker(
  SYNC_QUEUE,
  (job) =>
    syncCatalogConnection(
      database.db,
      job.data,
      new EnvironmentSecretResolver(process.env),
    ),
  {
    connection: {
      ...redisConnection(env.REDIS_URL),
      maxRetriesPerRequest: null,
    },
    concurrency: 1,
    lockDuration: 5 * 60 * 1000,
  },
);
const queue = new Queue(IMPORT_QUEUE, {
  connection: { ...redisConnection(env.REDIS_URL), maxRetriesPerRequest: 1 },
});
const syncQueue = new Queue(SYNC_QUEUE, {
  connection: { ...redisConnection(env.REDIS_URL), maxRetriesPerRequest: 1 },
});
let publishing = false;
const publishOutbox = async () => {
  if (publishing) return;
  publishing = true;
  try {
    const events = (await withWorkerRole(database.db, (tx) =>
      tx
        .select()
        .from(importOutboxEvents)
        .where(
          and(
            isNull(importOutboxEvents.publishedAt),
            lte(importOutboxEvents.availableAt, new Date()),
          ),
        )
        .limit(20),
    )) as (typeof importOutboxEvents.$inferSelect)[];
    for (const event of events) {
      try {
        const queuedJob = await enqueueImportOutboxEvent(queue, event);
        operationalLog('info', 'outbox_published', {
          jobId: queuedJob.id,
          importRunId: event.runId,
          merchantId: event.merchantId,
        });
        await withWorkerRole(database.db, (tx) =>
          tx
            .update(importOutboxEvents)
            .set({ publishedAt: new Date(), attempts: event.attempts + 1 })
            .where(eq(importOutboxEvents.id, event.id)),
        );
      } catch (error) {
        await withWorkerRole(database.db, (tx) =>
          tx
            .update(importOutboxEvents)
            .set({
              attempts: event.attempts + 1,
              availableAt: new Date(
                Date.now() + Math.min(60000, 1000 * 2 ** event.attempts),
              ),
            })
            .where(eq(importOutboxEvents.id, event.id)),
        );
        operationalLog('error', 'outbox_publish_failed', {
          importRunId: event.runId,
          merchantId: event.merchantId,
          error: error instanceof Error ? error.message : 'unknown',
        });
      }
    }
  } finally {
    publishing = false;
  }
};
const outboxTimer = setInterval(() => void publishOutbox(), 1000);
const enqueueDueSyncs = async () => {
  const active = (await withWorkerRole(database.db, (tx) =>
    tx
      .select({ id: connections.id, merchantId: connections.merchantId })
      .from(connections)
      .where(
        and(
          eq(connections.active, true),
          eq(connections.provider, 'woocommerce'),
          inArray(connections.authorizationStatus, ['pending', 'active']),
        ),
      ),
  )) as { id: string; merchantId: string }[];
  const bucket = Math.floor(Date.now() / (5 * 60 * 1000));
  for (const connection of active) {
    const job = connectionToSyncJob(connection);
    await syncQueue.add('woocommerce-sync', job, {
      jobId: `${connection.id}-${bucket}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 100,
      removeOnFail: 100,
    });
  }
};
const reportSchedulerError = (name: string, error: unknown) =>
  operationalLog('error', 'scheduler_failed', {
    scheduler: name,
    error: error instanceof Error ? error.message : 'unknown',
  });
const syncTimer = setInterval(
  () =>
    void enqueueDueSyncs().catch((error) =>
      reportSchedulerError('Sync', error),
    ),
  5 * 60 * 1000,
);
void publishOutbox().catch((error) => reportSchedulerError('Outbox', error));
void enqueueDueSyncs().catch((error) => reportSchedulerError('Sync', error));
const monitorOperations = async () => {
  for (const [name, monitoredQueue] of [
    ['import', queue],
    ['sync', syncQueue],
  ] as const) {
    const [oldest] = await monitoredQueue.getJobs(
      ['waiting', 'delayed'],
      0,
      0,
      true,
    );
    if (oldest && Date.now() - oldest.timestamp > 5 * 60_000)
      operationalLog('warn', 'queue_lag', {
        queue: name,
        jobId: oldest.id,
        lagSeconds: Math.floor((Date.now() - oldest.timestamp) / 1000),
      });
  }
  const activeConnections = (await withWorkerRole(database.db, (tx) =>
    tx
      .select({
        id: connections.id,
        merchantId: connections.merchantId,
        lastFetchedAt: connections.lastFetchedAt,
      })
      .from(connections)
      .where(
        and(
          eq(connections.active, true),
          eq(connections.provider, 'woocommerce'),
        ),
      ),
  )) as {
    id: string;
    merchantId: string;
    lastFetchedAt: Date | null;
  }[];
  for (const connection of activeConnections)
    if (
      !connection.lastFetchedAt ||
      Date.now() - connection.lastFetchedAt.getTime() > 30 * 60_000
    )
      operationalLog('warn', 'catalog_stale', {
        connectionId: connection.id,
        merchantId: connection.merchantId,
        ageSeconds: connection.lastFetchedAt
          ? Math.floor((Date.now() - connection.lastFetchedAt.getTime()) / 1000)
          : null,
      });
};
const monitorTimer = setInterval(
  () =>
    void monitorOperations().catch((error) =>
      reportSchedulerError('Monitor', error),
    ),
  60_000,
);
void monitorOperations().catch((error) =>
  reportSchedulerError('Monitor', error),
);
worker.on('completed', (job) =>
  operationalLog('info', 'import_completed', {
    jobId: job.id,
    importRunId: job.data?.runId,
    merchantId: job.data?.merchantId,
  }),
);
worker.on('failed', (job, error) =>
  operationalLog('error', 'import_failed', {
    jobId: job?.id,
    importRunId: job?.data?.runId,
    merchantId: job?.data?.merchantId,
    error: error.message,
  }),
);
worker.on('error', (error) =>
  operationalLog('error', 'import_worker_error', { error: error.message }),
);
syncWorker.on('completed', (job) =>
  operationalLog('info', 'sync_completed', {
    jobId: job.id,
    connectionId: job.data?.connectionId,
    merchantId: job.data?.merchantId,
  }),
);
syncWorker.on('failed', (job, error) =>
  operationalLog('error', 'sync_failed', {
    jobId: job?.id,
    connectionId: job?.data?.connectionId,
    merchantId: job?.data?.merchantId,
    error: error.message,
  }),
);
syncWorker.on('error', (error) =>
  operationalLog('error', 'sync_worker_error', { error: error.message }),
);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, async () => {
    clearInterval(outboxTimer);
    clearInterval(syncTimer);
    clearInterval(monitorTimer);
    await worker.close();
    await syncWorker.close();
    await queue.close();
    await syncQueue.close();
    await database.close();
  });
