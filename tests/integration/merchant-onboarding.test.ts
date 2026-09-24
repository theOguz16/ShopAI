import { rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Queue } from 'bullmq';
import { and, eq, sql } from 'drizzle-orm';
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
  connectorSecretAudit,
  connectorSecrets,
  memberships,
  merchantCredentialOwnerships,
  merchants,
  sessions,
  users,
} from '../../packages/db/src/schema.js';
import { withTenant } from '../../packages/db/src/tenant-context.js';

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
  const encryptionKey = Buffer.alloc(32, 7).toString('base64');
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
    CONNECTOR_SECRET_ENCRYPTION_KEY: encryptionKey,
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
            : new WooCommerceConnector(
                value,
                connectorFetcher,
                undefined,
                3,
                async () => 'TRY',
              );
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
      connectorFetchMock.mockImplementation(
        async (input) =>
          new Response(
            new URL(String(input)).pathname.endsWith('/settings/general')
              ? JSON.stringify([{ id: 'woocommerce_currency', value: 'TRY' }])
              : '[]',
            { status: 200 },
          ),
      );
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
      connectorFetchMock.mockImplementation(
        async (input) =>
          new Response(
            new URL(String(input)).pathname.endsWith('/settings/general')
              ? JSON.stringify([{ id: 'woocommerce_currency', value: 'TRY' }])
              : '[]',
            { status: 200, headers: { 'x-wp-totalpages': '1' } },
          ),
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

      const refs = await app.inject({
        method: 'GET',
        url: `/v1/merchants/${merchantId}/credential-refs`,
        headers: { cookie },
      });
      expect(refs.body).not.toContain('ONBOARDING_');

      const [stored] = await database.db
        .select({ credentialsRef: connections.credentialsRef })
        .from(connections)
        .where(eq(connections.id, body.connection.id));
      expect(stored?.credentialsRef).toMatch(
        /^secret:\/\/ONBOARDING_[A-F0-9]{32}$/u,
      );
      if (!stored?.credentialsRef)
        throw new Error('Managed connector secret referansı bulunamadı.');
      const resolved = await new ManagedConnectorSecretStore(
        uploadDir,
        encryptionKey,
      ).resolveScoped(stored.credentialsRef, {
        merchantId,
        connectionId: body.connection.id,
        provider: 'woocommerce',
      });
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
        new EnvironmentSecretResolver({
          UPLOAD_DIR: uploadDir,
          CONNECTOR_SECRET_ENCRYPTION_KEY: encryptionKey,
        }),
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

    it('rotates only after validation', async () => {
      const [before] = await database.db
        .select()
        .from(connections)
        .where(eq(connections.provider, 'woocommerce'))
        .limit(1);
      expect(before?.credentialsRef).toBeTruthy();
      const url = `/v1/merchants/${merchantId}/connections/${before.id}/rotate-secret`;
      connectorFetchMock.mockResolvedValue(new Response('{}', { status: 401 }));
      const rejected = await app.inject({
        method: 'POST',
        url,
        headers: { cookie },
        payload: {
          ...wooPayload(),
          consumerSecret: 'cs_rejected_rotation_value',
        },
      });
      expect(rejected.statusCode).toBe(422);
      expect(rejected.body).not.toContain('cs_rejected_rotation_value');
      const [still] = await database.db
        .select()
        .from(connections)
        .where(eq(connections.id, before.id));
      expect(still.credentialsRef).toBe(before.credentialsRef);
      connectorFetchMock.mockImplementation(
        async () => new Response('[]', { status: 200 }),
      );
      const accepted = await app.inject({
        method: 'POST',
        url,
        headers: { cookie },
        payload: {
          ...wooPayload(),
          consumerSecret: 'cs_accepted_rotation_value',
        },
      });
      expect(accepted.statusCode).toBe(200);
      const [after] = await database.db
        .select()
        .from(connections)
        .where(eq(connections.id, before.id));
      if (!after.credentialsRef || !before.credentialsRef)
        throw new Error('Secret reference missing.');
      expect(after.credentialsRef).not.toBe(before.credentialsRef);
      const records = await database.db
        .select()
        .from(connectorSecrets)
        .where(eq(connectorSecrets.connectionId, before.id));
      expect(records.map((item) => item.status).sort()).toEqual([
        'active',
        'rotated',
      ]);
      const otherMerchantId = randomUUID();
      await database.db.insert(merchants).values({
        id: otherMerchantId,
        name: 'Other Merchant',
        slug: `other-${otherMerchantId.slice(0, 8)}`,
      });
      const foreign = await withTenant(database.db, otherMerchantId, (tx) =>
        tx
          .select()
          .from(connectorSecrets)
          .where(eq(connectorSecrets.reference, after.credentialsRef)),
      );
      expect(foreign).toEqual([]);
      const forged = await syncCatalogConnection(
        database.db,
        { merchantId: otherMerchantId, connectionId: before.id },
        new EnvironmentSecretResolver({
          UPLOAD_DIR: uploadDir,
          CONNECTOR_SECRET_ENCRYPTION_KEY: encryptionKey,
        }),
      );
      expect(forged).toEqual({ skipped: true });
      await database.db
        .update(connections)
        .set({ credentialsRef: before.credentialsRef })
        .where(eq(connections.id, before.id));
      try {
        const stale = await syncCatalogConnection(
          database.db,
          { merchantId, connectionId: before.id },
          new EnvironmentSecretResolver({
            UPLOAD_DIR: uploadDir,
            CONNECTOR_SECRET_ENCRYPTION_KEY: encryptionKey,
          }),
        );
        expect(stale).toEqual({ skipped: true });
      } finally {
        await database.db
          .update(connections)
          .set({ credentialsRef: after.credentialsRef })
          .where(eq(connections.id, before.id));
      }
      const scope = {
        merchantId,
        connectionId: before.id,
        provider: 'woocommerce',
      };
      const store = new ManagedConnectorSecretStore(uploadDir, encryptionKey);
      await expect(
        store.resolveScoped(after.credentialsRef, scope),
      ).resolves.toMatchObject({
        consumerSecret: 'cs_accepted_rotation_value',
      });
      const events = await database.db
        .select()
        .from(connectorSecretAudit)
        .where(eq(connectorSecretAudit.connectionId, before.id));
      expect(events.map((item) => item.event)).toEqual(
        expect.arrayContaining(['created', 'accessed', 'rotated']),
      );
      expect(JSON.stringify(events)).not.toContain(
        'cs_accepted_rotation_value',
      );
    });

    it('keeps resolver failures out of DB status, audit and worker errors', async () => {
      const [row] = await database.db
        .select()
        .from(connections)
        .where(eq(connections.provider, 'woocommerce'))
        .limit(1);
      const leakedValue = 'cs_accepted_rotation_value';
      await expect(
        syncCatalogConnection(
          database.db,
          { merchantId, connectionId: row.id },
          {
            resolve: async () => {
              throw new Error(leakedValue);
            },
          },
        ),
      ).rejects.toThrow('Catalog sync failed');
      const [failed] = await database.db
        .select({ lastSyncError: connections.lastSyncError })
        .from(connections)
        .where(eq(connections.id, row.id));
      expect(failed.lastSyncError).toBe('Catalog sync failed');
      const audit = await database.db
        .select()
        .from(connectorSecretAudit)
        .where(eq(connectorSecretAudit.connectionId, row.id));
      expect(audit.map((item) => item.event)).toContain('resolution_failed');
      expect(JSON.stringify(audit)).not.toContain(leakedValue);
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
      const resolved = await new ManagedConnectorSecretStore(
        uploadDir,
        encryptionKey,
      ).resolveScoped(stored.credentialsRef, {
        merchantId,
        connectionId: body.connection.id,
        provider: 'trendyol',
      });
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

    it('revokes a queued connection before worker resolution', async () => {
      const [row] = await database.db
        .select()
        .from(connections)
        .where(eq(connections.provider, 'woocommerce'))
        .limit(1);
      if (!row.credentialsRef) throw new Error('Secret reference missing.');
      const removed = await app.inject({
        method: 'DELETE',
        url: `/v1/merchants/${merchantId}/connections/${row.id}`,
        headers: { cookie },
      });
      expect(removed.statusCode).toBe(200);
      const skipped = await syncCatalogConnection(
        database.db,
        { merchantId, connectionId: row.id },
        new EnvironmentSecretResolver({
          UPLOAD_DIR: uploadDir,
          CONNECTOR_SECRET_ENCRYPTION_KEY: encryptionKey,
        }),
      );
      expect(skipped).toEqual({ skipped: true });
      const [secret] = await database.db
        .select()
        .from(connectorSecrets)
        .where(
          and(
            eq(connectorSecrets.connectionId, row.id),
            eq(connectorSecrets.reference, row.credentialsRef),
          ),
        );
      expect(secret.status).toBe('revoked');
      const events = await database.db
        .select()
        .from(connectorSecretAudit)
        .where(eq(connectorSecretAudit.connectionId, row.id));
      expect(events.map((item) => item.event)).toContain('revoked');
      expect(events.map((item) => item.event)).toContain('resolution_failed');
    });

    it('migrates a legacy reference once and leaves rollback material intact', async () => {
      const store = new ManagedConnectorSecretStore(uploadDir, encryptionKey);
      const oldReference = await store.create(wooPayload());
      const [legacy] = await database.db
        .insert(connections)
        .values({
          merchantId,
          provider: 'woocommerce',
          credentialsRef: oldReference,
          authorizationStatus: 'active',
        })
        .returning({ id: connections.id });
      await database.db.insert(merchantCredentialOwnerships).values({
        merchantId,
        provider: 'woocommerce',
        credentialsRef: oldReference,
      });
      const run = () =>
        execFileSync(
          'pnpm',
          ['exec', 'tsx', 'scripts/migrate-connector-secrets.mts', '--apply'],
          {
            cwd: process.cwd(),
            env: {
              ...process.env,
              DEPLOY_ENV: 'local',
              DATABASE_URL: databaseUrl ?? '',
              UPLOAD_DIR: uploadDir,
              CONNECTOR_SECRET_ENCRYPTION_KEY: encryptionKey,
            },
            encoding: 'utf8',
          },
        );
      expect(JSON.parse(run())).toMatchObject({ migrated: 1 });
      const [changed] = await database.db
        .select()
        .from(connections)
        .where(eq(connections.id, legacy.id));
      expect(changed.credentialsRef).not.toBe(oldReference);
      await expect(store.resolve(oldReference)).resolves.toEqual(wooPayload());
      expect(JSON.parse(run())).toMatchObject({ migrated: 0 });
      const records = await database.db
        .select()
        .from(connectorSecrets)
        .where(eq(connectorSecrets.connectionId, legacy.id));
      expect(records).toHaveLength(1);
    });

    it('rolls back a migrated reference while OpenBao is unavailable, then stays idempotent', async () => {
      const store = new ManagedConnectorSecretStore(uploadDir, encryptionKey);
      const [connection] = await database.db
        .insert(connections)
        .values({
          merchantId,
          provider: 'woocommerce',
          authorizationStatus: 'active',
        })
        .returning({ id: connections.id });
      const scope = {
        merchantId,
        connectionId: connection.id,
        provider: 'woocommerce',
      };
      const oldReference = await store.createScoped(wooPayload(), scope);
      const managedReference = `secret://ONBOARDING_${randomUUID().replaceAll('-', '').toUpperCase()}`;
      await database.db
        .update(connections)
        .set({ credentialsRef: managedReference })
        .where(eq(connections.id, connection.id));
      await database.db.insert(merchantCredentialOwnerships).values({
        merchantId,
        provider: 'woocommerce',
        credentialsRef: oldReference,
      });
      await database.db.insert(connectorSecrets).values([
        {
          ...scope,
          reference: oldReference,
          backend: 'file',
          version: 1,
          status: 'rotated',
        },
        {
          ...scope,
          reference: managedReference,
          backend: 'openbao',
          version: 2,
          status: 'active',
        },
      ]);
      await database.db.insert(connectorSecretAudit).values([
        {
          merchantId,
          connectionId: connection.id,
          reference: oldReference,
          event: 'rotated',
          actor: 'migration',
        },
        {
          merchantId,
          connectionId: connection.id,
          reference: managedReference,
          event: 'created',
          actor: 'migration',
        },
      ]);
      const rollback = () =>
        execFileSync(
          'pnpm',
          [
            'exec',
            'tsx',
            'scripts/migrate-connector-secrets.mts',
            '--rollback',
          ],
          {
            cwd: process.cwd(),
            env: {
              ...process.env,
              DEPLOY_ENV: 'production',
              DATABASE_URL: databaseUrl ?? '',
              UPLOAD_DIR: uploadDir,
              CONNECTOR_SECRET_ENCRYPTION_KEY: encryptionKey,
              CONNECTOR_SECRET_BACKEND: 'openbao',
              CONNECTOR_SECRET_OPENBAO_ADDRESS: 'https://127.0.0.1:1',
              CONNECTOR_SECRET_OPENBAO_MOUNT: 'shopai-production',
              CONNECTOR_SECRET_OPENBAO_ROLE_ID: 'unavailable-role',
              CONNECTOR_SECRET_OPENBAO_SECRET_ID: 'unavailable-secret-id',
            },
            encoding: 'utf8',
          },
        );
      expect(JSON.parse(rollback())).toMatchObject({ restored: 1 });
      expect(JSON.parse(rollback())).toMatchObject({ restored: 0 });
      const [active] = await database.db
        .select({ reference: connections.credentialsRef })
        .from(connections)
        .where(eq(connections.id, connection.id));
      expect(active.reference).toBe(oldReference);
      await expect(
        store.resolveScoped(active.reference!, scope),
      ).resolves.toEqual(wooPayload());
      await syncCatalogConnection(
        database.db,
        { merchantId, connectionId: connection.id },
        new EnvironmentSecretResolver({
          UPLOAD_DIR: uploadDir,
          CONNECTOR_SECRET_ENCRYPTION_KEY: encryptionKey,
        }),
        (provider, credentials) => {
          expect(provider).toBe('woocommerce');
          expect(credentials).toEqual(wooPayload());
          return {
            provider: 'woocommerce',
            capabilities: { liveInventory: true, incrementalSync: true },
            validate: async () => undefined,
            readPage: async () => ({
              rows: [],
              nextCursor: null,
              sourceObservedAt: new Date().toISOString(),
              fetchedAt: new Date().toISOString(),
              complete: true,
            }),
          };
        },
        undefined,
        undefined,
        undefined,
        'file',
      );
      const audit = await database.db
        .select({
          event: connectorSecretAudit.event,
          actor: connectorSecretAudit.actor,
        })
        .from(connectorSecretAudit)
        .where(eq(connectorSecretAudit.connectionId, connection.id));
      expect(
        audit.filter(
          (row) => row.actor === 'migration-rollback-openbao-cleanup-pending',
        ),
      ).toHaveLength(1);
      expect(JSON.stringify(audit)).not.toContain(consumerSecret);
    });

    it('rejects missing, unscoped and wrong-connection rollback targets', async () => {
      const store = new ManagedConnectorSecretStore(uploadDir, encryptionKey);
      const [connection] = await database.db
        .insert(connections)
        .values({
          merchantId,
          provider: 'woocommerce',
          authorizationStatus: 'active',
        })
        .returning({ id: connections.id });
      const scope = {
        merchantId,
        connectionId: connection.id,
        provider: 'woocommerce',
      };
      const oldReference = `secret://ONBOARDING_${randomUUID().replaceAll('-', '').toUpperCase()}`;
      const managedReference = `secret://ONBOARDING_${randomUUID().replaceAll('-', '').toUpperCase()}`;
      await database.db
        .update(connections)
        .set({ credentialsRef: managedReference })
        .where(eq(connections.id, connection.id));
      await database.db.insert(connectorSecrets).values([
        {
          ...scope,
          reference: oldReference,
          backend: 'file',
          version: 1,
          status: 'rotated',
        },
        {
          ...scope,
          reference: managedReference,
          backend: 'openbao',
          version: 2,
          status: 'active',
        },
      ]);
      await database.db.insert(connectorSecretAudit).values([
        {
          merchantId,
          connectionId: connection.id,
          reference: oldReference,
          event: 'rotated',
          actor: 'migration',
        },
        {
          merchantId,
          connectionId: connection.id,
          reference: managedReference,
          event: 'created',
          actor: 'migration',
        },
      ]);
      const rollback = () =>
        execFileSync(
          'pnpm',
          [
            'exec',
            'tsx',
            'scripts/migrate-connector-secrets.mts',
            '--rollback',
          ],
          {
            cwd: process.cwd(),
            env: {
              ...process.env,
              DEPLOY_ENV: 'staging',
              DATABASE_URL: databaseUrl ?? '',
              UPLOAD_DIR: uploadDir,
              CONNECTOR_SECRET_ENCRYPTION_KEY: encryptionKey,
              CONNECTOR_SECRET_BACKEND: 'openbao',
              CONNECTOR_SECRET_OPENBAO_ADDRESS: 'https://127.0.0.1:1',
              CONNECTOR_SECRET_OPENBAO_MOUNT: 'shopai-staging',
              CONNECTOR_SECRET_OPENBAO_ROLE_ID: 'unavailable-role',
              CONNECTOR_SECRET_OPENBAO_SECRET_ID: 'unavailable-secret-id',
            },
            encoding: 'utf8',
          },
        );
      expect(rollback).toThrow();
      const [unchanged] = await database.db
        .select({ reference: connections.credentialsRef })
        .from(connections)
        .where(eq(connections.id, connection.id));
      expect(unchanged.reference).toBe(managedReference);
      const wrongConnectionScope = { ...scope, connectionId: randomUUID() };
      const wrongReference = await store.createScoped(
        wooPayload(),
        wrongConnectionScope,
      );
      await database.db
        .update(connectorSecrets)
        .set({ reference: wrongReference })
        .where(eq(connectorSecrets.reference, oldReference));
      await database.db
        .update(connectorSecretAudit)
        .set({ reference: wrongReference })
        .where(eq(connectorSecretAudit.reference, oldReference));
      expect(rollback).toThrow();
      const [stillActive] = await database.db
        .select({ reference: connections.credentialsRef })
        .from(connections)
        .where(eq(connections.id, connection.id));
      expect(stillActive.reference).toBe(managedReference);
      const wrongMerchantReference = await store.createScoped(wooPayload(), {
        ...scope,
        merchantId: randomUUID(),
      });
      await database.db
        .update(connectorSecrets)
        .set({ reference: wrongMerchantReference })
        .where(eq(connectorSecrets.reference, wrongReference));
      await database.db
        .update(connectorSecretAudit)
        .set({ reference: wrongMerchantReference })
        .where(eq(connectorSecretAudit.reference, wrongReference));
      expect(rollback).toThrow();
      const validReference = await store.createScoped(wooPayload(), scope);
      await database.db
        .update(connectorSecrets)
        .set({ reference: validReference })
        .where(eq(connectorSecrets.reference, wrongMerchantReference));
      expect(rollback).toThrow();
      await database.db
        .update(connections)
        .set({ active: false })
        .where(eq(connections.id, connection.id));
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
