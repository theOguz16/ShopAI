import { rm } from 'node:fs/promises';
import { Queue } from 'bullmq';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../apps/api/src/app.js';
import { parseApiEnv } from '../../apps/api/src/env.js';
import { redisConnection } from '../../apps/worker/src/connection.js';
import { SYNC_QUEUE } from '../../packages/contracts/src/index.js';
import {
  connections,
  connectionSyncProgress,
  createDatabase,
  memberships,
  merchantCredentialOwnerships,
  merchants,
  products,
  sessions,
  users,
  withTenant,
  writeConnectionSyncProgress,
} from '../../packages/db/src/index.js';

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;

if (!databaseUrl || !redisUrl) {
  describe.skip('connection sync status integration', () => {
    it('requires PostgreSQL and Redis', () => undefined);
  });
} else {
  const email = 'sync-status@test.example';
  const loginToken = 'sync-status-test-token-000000';
  const uploadDir = `/tmp/shopai-sync-status-${process.pid}`;
  const env = parseApiEnv({
    CATALOG_MODE: 'postgres',
    DATABASE_URL: databaseUrl,
    REDIS_URL: redisUrl,
    MCP_PUBLIC_ORIGIN: 'https://api.sync-status.test',
    WIDGET_ORIGIN: 'https://widget.sync-status.test',
    REDIRECT_SIGNING_SECRET: 'sync-status-redirect-secret-000000000000000000',
    AUTH_PILOT_CREDENTIALS: JSON.stringify({ [email]: loginToken }),
    LOGIN_RATE_LIMIT_MAX: '30',
    UPLOAD_DIR: uploadDir,
    LOG_LEVEL: 'silent',
  });
  const database = createDatabase(databaseUrl, {
    applicationName: 'shopai-sync-status-fixtures',
  });
  const queue = new Queue(SYNC_QUEUE, {
    connection: redisConnection(redisUrl),
  });
  let app: Awaited<ReturnType<typeof buildApp>>;
  let cookie = '';
  let merchantId = '';
  let connectionId = '';

  const buildTestApp = () =>
    buildApp(undefined, env, {
      onboardingConnectorFactory: () => ({
        validate: async () => undefined,
      }),
    });

  describe.sequential('connection sync status integration', () => {
    beforeAll(async () => {
      await rm(uploadDir, { recursive: true, force: true });
      await queue.obliterate({ force: true });
      await database.db.execute(
        sql`truncate table ${connectionSyncProgress}, ${connections}, ${merchantCredentialOwnerships}, ${memberships}, ${sessions}, ${users}, ${merchants} cascade`,
      );
      app = await buildTestApp();
      const login = await app.inject({
        method: 'POST',
        url: '/v1/auth/login',
        payload: { email, token: loginToken },
      });
      expect(login.statusCode).toBe(200);
      cookie = login.headers['set-cookie']?.split(';')[0] ?? '';
      const setup = await app.inject({
        method: 'POST',
        url: '/v1/setup/merchant',
        headers: { cookie },
        payload: { name: '10k Fixture Store' },
      });
      expect(setup.statusCode).toBe(201);
      merchantId = setup.json<{ merchant: { id: string } }>().merchant.id;
    });

    afterAll(async () => {
      await app?.close();
      await queue.obliterate({ force: true });
      await queue.close();
      await database.close();
      await rm(uploadDir, { recursive: true, force: true });
    });

    it('returns immediately with queued state while catalog work remains in BullMQ', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/v1/merchants/${merchantId}/onboarding/woocommerce/connect`,
        headers: { cookie },
        payload: {
          storeUrl: 'https://shop.example',
          consumerKey: 'ck_sync_status_fixture',
          consumerSecret: 'cs_sync_status_fixture',
        },
      });
      expect(response.statusCode).toBe(201);
      connectionId = response.json<{ connection: { id: string } }>().connection.id;

      const status = await app.inject({
        method: 'GET',
        url: `/v1/connections/${connectionId}/sync-status`,
        headers: { cookie },
      });
      expect(status.statusCode).toBe(200);
      expect(status.json()).toMatchObject({
        connectionId,
        status: 'queued',
        foundProducts: 0,
        processedProducts: 0,
        failedProducts: 0,
        variants: 0,
      });

      const queued = await queue.getJob(`onboarding-${connectionId}`);
      expect(queued?.data).toEqual({ merchantId, connectionId });
      const productRows = await withTenant(database.db, merchantId, (tx) =>
        tx.select({ id: products.id }).from(products),
      );
      expect(productRows).toHaveLength(0);
    });

    it('restores 10k sync counters from PostgreSQL after the API app is rebuilt', async () => {
      const startedAt = new Date('2026-09-10T11:30:00.000Z');
      await writeConnectionSyncProgress(
        database.db,
        merchantId,
        connectionId,
        {
          status: 'running',
          foundProducts: 10_000,
          processedProducts: 6_027,
          failedProducts: 3,
          variants: 12_845,
          startedAt,
          completedAt: null,
          error: null,
        },
        new Date('2026-09-10T11:31:00.000Z'),
      );

      const beforeRefresh = await app.inject({
        method: 'GET',
        url: `/v1/connections/${connectionId}/sync-status`,
        headers: { cookie },
      });
      expect(beforeRefresh.json()).toMatchObject({
        status: 'running',
        foundProducts: 10_000,
        processedProducts: 6_027,
        failedProducts: 3,
        variants: 12_845,
      });

      await app.close();
      app = await buildTestApp();
      const afterRefresh = await app.inject({
        method: 'GET',
        url: `/v1/connections/${connectionId}/sync-status`,
        headers: { cookie },
      });
      expect(afterRefresh.statusCode).toBe(200);
      expect(afterRefresh.json()).toMatchObject({
        connectionId,
        status: 'running',
        foundProducts: 10_000,
        processedProducts: 6_027,
        failedProducts: 3,
        variants: 12_845,
        error: null,
      });
    });
  });
}
