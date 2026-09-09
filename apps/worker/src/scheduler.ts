import { syncJobSchema, type SyncJob } from '@shopai/contracts';

export type ScheduledConnection = {
  id: string;
  merchantId: string;
};

export function connectionToSyncJob(connection: ScheduledConnection): SyncJob {
  return syncJobSchema.parse({
    connectionId: connection.id,
    merchantId: connection.merchantId,
  });
}
