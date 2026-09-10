import { rm } from 'node:fs/promises';
import { Queue } from 'bullmq';
import { eq, sql } from 'drizzle-orm';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { buildApp } from '../../apps/api/src/app.js';
import { parseApiEnv } from '../../apps/api/src/env.js';
import { redisConnection } from '../../apps/worker/src/connection.js';
import {
  EnvironmentSecretResolver,
  syncCatalogConnection,
} from '../../apps/worker/src/sync.js';
import {
  ManagedConnectorSecretStore,
  WooCommerceConnector,
  type WooCommerceCredentials,
} from '../../packages/connectors/src/index.js';
import { SYNC_QUEUE } from '../../packages/contracts/src/index.js';
import { createDatabase } from '../../packages/db/src/client.js';
import {
  connections,
  memberships,
  merchantCredentialOwnerships,
  merchants,
  sessions,
  users,
} from '../../packages/db/src/schema.js';

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;

if (!databaseUrl || !redisUrl) {
  describe.skip('merchant WooCommerce onboarding', () => {
    it('requires PostgreSQL and Redis integration services', () => {});
  });
} else {
  const uploadDir = `/tmp/shopai-onboarding-${process.pid}`;
  const email = 'merchant-onboarding@test.example';
  const loginToken = 'merchant-onboarding-test-token';
  const consumerKey = 'ck_onboarding_secret_value';
  const consumerSecret = 'cs_onboarding_secret_value';
  const storeUrl = 'https://8.8.8.8';
  const env = parseApiEnv({
    CATALOG_MODE: 'postgres',
    DATABASE_URL: databaseUrl,
    REDIS_URL: redisUrl,
    MCP_PUBLIC_ORIGIN: 'https://api.onboarding.test',
    WIDGET_ORIGIN: 'https://widget.onboarding.test',
    REDIRECT_SIGNING_SECRET: 'onboarding-redirect-secret-0000000000000000',
    AUTH_PILOT_CREDENTIALS: JSON.stringify({ [email]: loginToken }),
    LOGIN_RATE_LIMIT_MAX: '30',
    UPLOAD_DIR: uploadDir,
    LOG_LEVEL: 'silent',
  });
  const database = createDatabase(databaseUrl, {
    applicationName: 'shopai-onboarding-fixtures',
  });
  const queue = new Queue(SYNC_QUEUE, { connection: redisConnection(redisUrl) });
  const connectorFetchMock = vi.fn(
    async (_input: Parameters<typeof fetch>[0], _init?: RequestInit) =>
      new Response('{}', { status: 500 }),
  );
  const connectorFetcher = connectorFetchMock as unknown as typeof fetch;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let cookie = '';
  let merchantId = '';

  beforeAll(async () => {
    await rm(uploadDir, { recursive: true, force: true });
    await queue.obliterate({ force: true });
    await database.db.execute(
      sql`truncate table ${connections}, ${merchantCredentialOwnerships}, ${memberships}, ${sessions}, ${users}, ${merchants} cascade`,
    );
    app = await buildApp(undefined, env, {
      onboardingConnectorFactory: (credentials) =>
        credentials.storeUrl.includes('127.0.0.1')
          ? new WooCommerceConnector(credentials)
          : new WooCommerceConnector(credentials, connectorFetcher),
    });
    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email, token: loginToken },
    });
    expect(login.statusCode).toBe(200);
    cookie = login.headers['set-cookie']?.split(';')[0] ?? '';
    expect(cookie).toContain('shopai_session=');
    const setup = await app.inject({
      method: 'POST',
      url: '/v1/setup/merchant',
      headers: { cookie },
      payload: { name: 'Onboarding Store' },
    });
    expect(setup.statusCode).toBe(201);
    merchantId = setup.json<{ merchant: { id: string } }>().merchant.id;
  });

  beforeEach(() => {
    connectorFetchMock.mockReset();
  });

  afterAll(async () => {
    await app.close();
    await queue.obliterate({ force: true });
    await queue.close();
    await database.close();
    await rm(uploadDir, { recursive: true, force: true });
  });

  const endpoint = (action: 'test' | 'connect') =>
    `/v1/merchants/${merchantId}/onboarding/woocommerce/${action}`;
  const payload = () => ({ storeUrl, consumerKey, consumerSecret });

  describe.sequential('merchant WooCommerce onboarding', () => {
    it('rejects private connector targets before making an HTTP request', async () => {
      const response = await app.inject({
        method: 'POST',
        url: endpoint('test'),
        headers: { cookie },
        payload: {
          ...payload(),
          storeUrl: 'https://127.0.0.1',
        },
      });
      expect(response.statusCode).toBe(422);
      expect(response.json()).toEqual({
        status: 'failed',
        code: 'CONNECTION_FAILED',
      });
      expect(connectorFetchMock).not.toHaveBeenCalled();
    });

    it('returns a generic failure for wrong WooCommerce credentials', async () => {
      connectorFetchMock.mockResolvedValue(new Response('{}', { status: 401 }));
      const response = await app.inject({
        method: 'POST',
        url: endpoint('test'),
        headers: { cookie },
        payload: payload(),
      });
      expect(response.statusCode).toBe(422);
      expect(response.json()).toEqual({
        status: 'failed',
        code: 'CONNECTION_FAILED',
      });
      expect(response.body).not.toContain(consumerKey);
      expect(response.body).not.toContain(consumerSecret);
    });

    it('confirms valid credentials without echoing them to the browser', async () => {
      connectorFetchMock.mockResolvedValue(new Response('[]', { status: 200 }));
      const response = await app.inject({
        method: 'POST',
        url: endpoint('test'),
        headers: { cookie },
        payload: payload(),
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        status: 'success',
        code: 'CONNECTION_OK',
      });
      expect(response.body).not.toContain(consumerKey);
      expect(response.body).not.toContain(consumerSecret);
      expect(connectorFetchMock).toHaveBeenCalledTimes(1);
      expect(connectorFetchMock.mock.calls[0]?.[1]).toMatchObject({
        redirect: 'manual',
      });
    });

    it('creates a managed connector and queues the first sync without returning secret material', async () => {
      connectorFetchMock.mockResolvedValue(
        new Response('[]', {
          status: 200,
          headers: { 'x-wp-totalpages': '1' },
        }),
      );
      const response = await app.inject({
        method: 'POST',
        url: endpoint('connect'),
        headers: { cookie },
        payload: payload(),
      });
      expect(response.statusCode).toBe(201);
      const body = response.json<{
        connection: {
          id: string;
          provider: string;
          authorizationStatus: string;
          syncMode: string;
        };
        sync: { status: string };
      }>();
      expect(body).toMatchObject({
        connection: {
          provider: 'woocommerce',
          authorizationStatus: 'pending',
          syncMode: 'incremental',
        },
        sync: { status: 'queued' },
      });
      expect(response.body).not.toContain(consumerKey);
      expect(response.body).not.toContain(consumerSecret);
      expect(response.body).not.toContain('credentialsRef');

      const [stored] = await database.db
        .select({ credentialsRef: connections.credentialsRef })
        .from(connections)
        .where(eq(connections.id, body.connection.id));
      expect(stored?.credentialsRef).toMatch(
        /^secret:\/\/ONBOARDING_[A-F0-9]{32}$/u,
      );
      if (!stored?.credentialsRef)
        throw new Error('Managed connector secret referansı bulunamadı.');
      const resolved = await new ManagedConnectorSecretStore(uploadDir).resolve(
        stored.credentialsRef,
      );
      expect(resolved).toEqual(payload());

      const queued = await queue.getJob(`onboarding-${body.connection.id}`);
      expect(queued?.data).toEqual({
        merchantId,
        connectionId: body.connection.id,
      });

      const listed = await app.inject({
        method: 'GET',
        url: `/v1/merchants/${merchantId}/connections`,
        headers: { cookie },
      });
      expect(listed.statusCode).toBe(200);
      expect(listed.body).not.toContain(consumerKey);
      expect(listed.body).not.toContain(consumerSecret);
      expect(listed.body).not.toContain(stored.credentialsRef);

      await syncCatalogConnection(
        database.db,
        { merchantId, connectionId: body.connection.id },
        new EnvironmentSecretResolver({ UPLOAD_DIR: uploadDir }),
        (_provider, credentials) => {
          expect(credentials).toEqual(payload());
          return new WooCommerceConnector(
            credentials as WooCommerceCredentials,
            connectorFetcher,
          );
        },
      );
      const [synced] = await database.db
        .select({
          authorizationStatus: connections.authorizationStatus,
          lastSuccessfulSyncAt: connections.lastSuccessfulSyncAt,
        })
        .from(connections)
        .where(eq(connections.id, body.connection.id));
      expect(synced?.authorizationStatus).toBe('active');
      expect(synced?.lastSuccessfulSyncAt).toBeInstanceOf(Date);
    });
  });
}
