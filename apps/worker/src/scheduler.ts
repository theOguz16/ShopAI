import { randomUUID } from 'node:crypto';
import { syncJobSchema, type SyncJob } from '@shopai/contracts';

export type ScheduledConnection = {
  id: string;
  merchantId: string;
};

/**
 * One scheduled sync gets one durable run id; BullMQ retries of the same job
 * reuse it, so a crashed attempt resumes from its checkpoint instead of
 * starting over.
 */
export function connectionToSyncJob(connection: ScheduledConnection): SyncJob {
  return syncJobSchema.parse({
    connectionId: connection.id,
    merchantId: connection.merchantId,
    syncRunId: randomUUID(),
  });
}
