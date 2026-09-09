import type { Queue } from 'bullmq';

export type ImportOutboxEvent = {
  runId: string;
  payload: unknown;
};

type ImportReference = {
  runId?: string;
  dispatchId?: string;
};

export function importDispatchJobId(event: ImportOutboxEvent) {
  const payload = event.payload as ImportReference | null;
  return payload?.dispatchId
    ? `${event.runId}-${payload.dispatchId}`
    : event.runId;
}

export function enqueueImportOutboxEvent(
  queue: Queue,
  event: ImportOutboxEvent,
) {
  return queue.add('csv-import', event.payload, {
    jobId: importDispatchJobId(event),
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
  });
}
