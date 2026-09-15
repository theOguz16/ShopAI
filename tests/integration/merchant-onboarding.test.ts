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
  TrendyolConnector,
  type TrendyolCredentials,
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
  describe.skip('merchant connector onboarding', () => {
    it('requires PostgreSQL and Redis integration services', () => {});
  });
} else {
  const uploadDir = `/tmp/shopai-onboarding-${process.pid}`;
  const email = 'merchant-onboarding@test.example';
  const loginToken = 'merchant-onboarding-test-token';
  const consumerKey = 'ck_onboarding_test_value';
  const consumerSecret = 'cs_onboarding_test_value';
  const storeUrl = 'https://8.8.8.8';
  const trendyolApiKey = 'trendyol_key_test_value';
  const trendyolApiSecret = 'trendyol_credential_test_value';
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
  const queue = new Queue(SYNC_QUEUE, {
    connection: redisConnection(redisUrl),
  });
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
      onboardingConnectorFactory: (provider, credentials) => {
        if (provider === 'woocommerce') {
          const value = credentials as WooCommerceCredentials;
          return value.storeUrl.includes('127.0.0.1')
            ? new WooCommerceConnector(value)
            : new WooCommerceConnector(value, connectorFetcher);
        }
        return new TrendyolConnector(
          credentials as TrendyolCredentials,
          connectorFetcher,
          async () => undefined,
          3,
          () => Date.now(),
          0,
        );
      },
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

  const endpoint = (
    provider: 'woocommerce' | 'trendyol',
    action: 'test' | 'connect',
  ) => `/v1/merchants/${merchantId}/onboarding/${provider}/${action}`;
  const wooPayload = () => ({ storeUrl, consumerKey, consumerSecret });
  const trendyolPayload = () => ({
    sellerId: '2748',
    apiKey: trendyolApiKey,
    apiSecret: trendyolApiSecret,
    environment: 'stage' as const,
  });

  describe.sequential('merchant connector onboarding', () => {
    it('rejects private WooCommerce connector targets before making an HTTP request', async () => {
      const response = await app.inject({
        method: 'POST',
        url: endpoint('woocommerce', 'test'),
        headers: { cookie },
        payload: {
          ...wooPayload(),
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
        url: endpoint('woocommerce', 'test'),
        headers: { cookie },
        payload: wooPayload(),
      });
      expect(response.statusCode).toBe(422);
      expect(response.json()).toEqual({
        status: 'failed',
        code: 'CONNECTION_FAILED',
      });
      expect(response.body).not.toContain(consumerKey);
      expect(response.body).not.toContain(consumerSecret);
    });

    it('confirms valid WooCommerce credentials without echoing them', async () => {
      connectorFetchMock.mockResolvedValue(new Response('[]', { status: 200 }));
      const response = await app.inject({
        method: 'POST',
        url: endpoint('woocommerce', 'test'),
        headers: { cookie },
        payload: wooPayload(),
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        status: 'success',
        code: 'CONNECTION_OK',
      });
      expect(response.body).not.toContain(consumerKey);
      expect(response.body).not.toContain(consumerSecret);
      expect(connectorFetchMock).toHaveBeenCalledTimes(1);
    });

    it('creates WooCommerce connector, stores secret material out of DB and queues first sync', async () => {
      connectorFetchMock.mockResolvedValue(
        new Response('[]', {
          status: 200,
          headers: { 'x-wp-totalpages': '1' },
        }),
      );
      const response = await app.inject({
        method: 'POST',
        url: endpoint('woocommerce', 'connect'),
        headers: { cookie },
        payload: wooPayload(),
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
      expect(resolved).toEqual(wooPayload());

      const queued = await queue.getJob(`onboarding-${body.connection.id}`);
      expect(queued?.name).toBe('catalog-sync');
      expect(queued?.data).toEqual({
        merchantId,
        connectionId: body.connection.id,
      });

      await syncCatalogConnection(
        database.db,
        { merchantId, connectionId: body.connection.id },
        new EnvironmentSecretResolver({ UPLOAD_DIR: uploadDir }),
        (provider, credentials) => {
          expect(provider).toBe('woocommerce');
          expect(credentials).toEqual(wooPayload());
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

    it('tests Trendyol stage credentials through Product V2 without echoing secrets', async () => {
      connectorFetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
      const response = await app.inject({
        method: 'POST',
        url: endpoint('trendyol', 'test'),
        headers: { cookie },
        payload: trendyolPayload(),
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        status: 'success',
        code: 'CONNECTION_OK',
      });
      expect(response.body).not.toContain(trendyolApiKey);
      expect(response.body).not.toContain(trendyolApiSecret);
      expect(connectorFetchMock).toHaveBeenCalledTimes(1);
      const requestUrl = new URL(String(connectorFetchMock.mock.calls[0]?.[0]));
      expect(requestUrl.origin).toBe('https://stageapigw.trendyol.com');
      expect(requestUrl.pathname).toBe(
        '/integration/product/sellers/2748/products/approved',
      );
      expect(connectorFetchMock.mock.calls[0]?.[1]).toMatchObject({
        redirect: 'manual',
        headers: expect.objectContaining({
          'user-agent': '2748 - ShopAI',
        }),
      });
    });

    it('allows Trendyol beside WooCommerce and automatically queues first sync', async () => {
      connectorFetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
      const response = await app.inject({
        method: 'POST',
        url: endpoint('trendyol', 'connect'),
        headers: { cookie },
        payload: trendyolPayload(),
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
          provider: 'trendyol',
          authorizationStatus: 'pending',
          syncMode: 'incremental',
        },
        sync: { status: 'queued' },
      });
      expect(response.body).not.toContain(trendyolApiKey);
      expect(response.body).not.toContain(trendyolApiSecret);
      expect(response.body).not.toContain('credentialsRef');

      const [stored] = await database.db
        .select({ credentialsRef: connections.credentialsRef })
        .from(connections)
        .where(eq(connections.id, body.connection.id));
      expect(stored?.credentialsRef).toMatch(
        /^secret:\/\/ONBOARDING_[A-F0-9]{32}$/u,
      );
      if (!stored?.credentialsRef)
        throw new Error('Trendyol managed secret referansı bulunamadı.');
      const resolved = await new ManagedConnectorSecretStore(uploadDir).resolve(
        stored.credentialsRef,
      );
      expect(resolved).toEqual(trendyolPayload());

      const queued = await queue.getJob(`onboarding-${body.connection.id}`);
      expect(queued?.name).toBe('catalog-sync');
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
      expect(listed.body).not.toContain(trendyolApiKey);
      expect(listed.body).not.toContain(trendyolApiSecret);
      expect(listed.body).not.toContain(stored.credentialsRef);
      const providers = listed
        .json<Array<{ provider: string; authorizationStatus: string }>>()
        .filter((item) => item.authorizationStatus !== 'revoked')
        .map((item) => item.provider);
      expect(providers).toEqual(
        expect.arrayContaining(['woocommerce', 'trendyol']),
      );
    });

    it('rejects unsupported onboarding providers', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/v1/merchants/${merchantId}/onboarding/unknown/test`,
        headers: { cookie },
        payload: {},
      });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ code: 'PROVIDER_NOT_FOUND' });
    });
  });
}
