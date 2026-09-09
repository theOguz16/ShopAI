import { createConnection } from 'node:net';
import { describe, expect, it } from 'vitest';
import { PostgresCatalogRepository } from '../../packages/db/src/catalog-repository.js';
import { createDatabase } from '../../packages/db/src/client.js';
import { parseApiEnv } from '../../apps/api/src/env.js';
import { parseWorkerEnv } from '../../apps/worker/src/env.js';

function pingRedis(redisUrl: string) {
  const url = new URL(redisUrl);
  return new Promise<string>((resolve, reject) => {
    const socket = createConnection(Number(url.port || 6379), url.hostname);
    socket.setTimeout(5000);
    socket.once('connect', () => socket.write('*1\r\n$4\r\nPING\r\n'));
    socket.once('data', (data) => {
      socket.end();
      resolve(data.toString());
    });
    socket.once('timeout', () => socket.destroy(new Error('Redis timeout')));
    socket.once('error', reject);
  });
}

describe('PostgreSQL and Redis infrastructure', () => {
  it('connects to the migrated PostgreSQL database', async () => {
    const env = parseApiEnv(process.env);
    expect(env.CATALOG_MODE).toBe('postgres');
    if (env.CATALOG_MODE !== 'postgres') throw new Error('postgres expected');
    const database = createDatabase(env.DATABASE_URL);
    try {
      await expect(
        new PostgresCatalogRepository(database.db).health(),
      ).resolves.toBeUndefined();
    } finally {
      await database.close();
    }
  });

  it('connects to Redis using the worker environment', async () => {
    const env = parseWorkerEnv(process.env);
    await expect(pingRedis(env.REDIS_URL)).resolves.toBe('+PONG\r\n');
  });
});
