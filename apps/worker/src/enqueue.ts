import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Queue } from 'bullmq';
import { IMPORT_QUEUE, importJobSchema } from '@shopai/contracts';
import { parseCatalogCsv } from '@shopai/connectors';
import { redisConnection } from './connection.js';
import { parseWorkerEnv } from './env.js';
const env = parseWorkerEnv(process.env);
const [path, merchantId, connectionId] = process.argv.slice(2);
if (!path || !merchantId || !connectionId)
  throw new Error(
    'Kullanım: import:csv <mutlak CSV yolu> <merchant UUID> <connection UUID>',
  );
const result = parseCatalogCsv(await readFile(path, 'utf8'));
if (result.errors.length) throw new Error(JSON.stringify(result.errors));
const data = importJobSchema.parse({
  schemaVersion: 1,
  runId: randomUUID(),
  observedAt: new Date().toISOString(),
  merchantId,
  connectionId,
  rows: result.rows,
});
const queue = new Queue(IMPORT_QUEUE, {
  connection: { ...redisConnection(env.REDIS_URL), maxRetriesPerRequest: 1 },
});
try {
  await queue.add('csv-import', data, {
    jobId: data.runId,
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 100 },
  });
  console.info('Import kuyruğa alındı:', data.runId);
} finally {
  await queue.close();
}
