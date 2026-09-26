import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
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
  type ConnectorSecretBackend,
  WooCommerceConnector,
  type WooCommerceCredentials,
} from '../../packages/connectors/src/index.js';
import type { SecretScope } from '../../packages/connectors/src/managed-secrets.js';
import { SYNC_QUEUE } from '../../packages/contracts/src/index.js';
import { createDatabase } from '../../packages/db/src/client.js';
import {
  connectionAudit,
  connectionPairings,
  connections,
  connectorSecretAudit,
  connectorSecrets,
  memberships,
  merchants,
  sessions,
  users,
} from '../../packages/db/src/schema.js';
import {
  bootstrapMerchant,
  withTenant,
} from '../../packages/db/src/tenant-context.js';

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;

if (!databaseUrl || !redisUrl) {
  describe.skip('woocommerce secure pairing', () => {
    it('requires PostgreSQL and Redis integration services', () => {});
  });
} else {
  const uploadDir = `/tmp/shopai-pairing-${process.pid}`;
  const email = 'woo-pairing@test.example';
  const loginToken = 'woo-pairing-test-token';
  // Distinctive fake credential values for exact-value leak scans.
  const rawConsumerKey = 'ck_pairing_raw_key_value_123';
  const rawConsumerSecret = 'cs_pairing_raw_secret_value_456';
  const rawRotatedKey = 'ck_pairing_rotated_key_value_789';
  const rawRotatedSecret = 'cs_pairing_rotated_secret_value_012';
  const storeUrlA = 'https://pairing-a.example';
  const storeUrlB = 'https://pairing-b.example';
  const storeUrlC = 'https://pairing-c.example';
  const encryptionKey = Buffer.alloc(32, 11).toString('base64');
  const env = parseApiEnv({
    CATALOG_MODE: 'postgres',
    DATABASE_URL: databaseUrl,
    REDIS_URL: redisUrl,
    MCP_PUBLIC_ORIGIN: 'https://api.pairing.test',
    WIDGET_ORIGIN: 'https://widget.pairing.test',
    // The dashboard origin used by the CSRF test cases must be allowlisted
    // regardless of the outer process env.
    MCP_ALLOWED_ORIGINS: 'https://chatgpt.com,http://127.0.0.1:3000',
    REDIRECT_SIGNING_SECRET: 'pairing-redirect-secret-000000000000000000',
    AUTH_PILOT_CREDENTIALS: JSON.stringify({ [email]: loginToken }),
    LOGIN_RATE_LIMIT_MAX: '30',
    UPLOAD_DIR: uploadDir,
    CONNECTOR_SECRET_ENCRYPTION_KEY: encryptionKey,
    PAIRING_COMPLETE_RATE_LIMIT_MAX: '100',
    LOG_LEVEL: 'error',
  });
  const database = createDatabase(databaseUrl, {
    applicationName: 'shopai-pairing-fixtures',
  });
  const queue = new Queue(SYNC_QUEUE, {
    connection: redisConnection(redisUrl),
  });

  // Recording secret backend standing in for the OpenBao managed backend.
  class RecordingSecretBackend implements ConnectorSecretBackend {
    readonly entries = new Map<
      string,
      { scope: SecretScope; credentials: unknown }
    >();
    private counter = 0;
    async createScoped(credentials: unknown, scope: SecretScope) {
      this.counter += 1;
      const reference = `secret://ONBOARDING_${this.counter
        .toString(16)
        .toUpperCase()
        .padStart(8, '0')}${'F'.repeat(24)}`;
      this.entries.set(reference, {
        scope: { ...scope },
        credentials,
      });
      return reference;
    }
    async resolveScoped(reference: string, scope: SecretScope) {
      const entry = this.entries.get(reference);
      if (!entry) throw new Error('secret not found');
      if (
        entry.scope.merchantId !== scope.merchantId ||
        entry.scope.connectionId !== scope.connectionId ||
        entry.scope.provider !== scope.provider
      )
        throw new Error('secret scope mismatch');
      return entry.credentials;
    }
    async rotateScoped(credentials: unknown, scope: SecretScope) {
      return this.createScoped(credentials, scope);
    }
    async revoke(reference: string) {
      this.entries.delete(reference);
    }
    async remove(reference: string) {
      this.entries.delete(reference);
    }
    async health() {}
  }
  const secretBackend = new RecordingSecretBackend();

  const okFetch = vi.fn(
    async () =>
      new Response('[]', {
        status: 200,
        headers: { 'x-wp-totalpages': '0' },
      }),
  );
  const unauthorizedFetch = vi.fn(
    async () => new Response('{"code":"unauthorized"}', { status: 401 }),
  );
  const redirectFetch = vi.fn(
    async () =>
      // A 3xx is returned as-is: the pinned fetcher never follows redirects,
      // so a redirect cannot smuggle a private-IP hop.
      new Response('', {
        status: 302,
        headers: { location: 'https://169.254.169.254/wp-json/' },
      }),
  );

  const pairingConnectorFactory = (
    provider: string,
    credentials: unknown,
  ): WooCommerceConnector => {
    if (provider !== 'woocommerce')
      throw new Error('unexpected provider in pairing factory');
    const value = credentials as WooCommerceCredentials;
    const host = new URL(value.storeUrl).hostname;
    if (host === '127.0.0.1' || host === '10.0.0.5' || host === '::1') {
      // Real connector: target-safety must reject private targets outright.
      return new WooCommerceConnector(value);
    }
    const fetcher = value.storeUrl.includes('redirect')
      ? redirectFetch
      : value.consumerSecret.includes('invalid')
        ? unauthorizedFetch
        : okFetch;
    return new WooCommerceConnector(
      value,
      fetcher,
      undefined,
      1,
      async () => 'TRY',
    );
  };

  let app: Awaited<ReturnType<typeof buildApp>>;
  let cookie = '';
  let merchantAId = '';
  let merchantBId = '';
  let ownerUserId = '';
  let editorUserId = '';
  let viewerUserId = '';
  let shopperUserId = '';
  let editorAuth: { cookie: string; headers: Record<string, string> };

  const pairingEndpoint = (merchantId: string) =>
    `/v1/merchants/${merchantId}/connections/woocommerce/pairing`;
  const completeEndpoint = '/v1/connectors/woocommerce/pairings/complete';

  const issueSession = async (userId: string, kind: 'merchant' | 'shopper') => {
    const raw = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(raw).digest('hex');
    await database.db.execute(sql`
      INSERT INTO sessions
        (user_id, token_hash, expires_at, absolute_expires_at, last_active_at,
         auth_level, authenticated_at, client_kind)
      VALUES
        (${userId}::uuid, ${tokenHash}, now() + interval '12 hours',
         now() + interval '12 hours', now(), 'mfa', now(), ${kind})
    `);
    return `shopai_oidc_session=${raw}`;
  };

  const authContextFor = async (userId: string) => {
    const sessionCookie = await issueSession(userId, 'merchant');
    const session = await app.inject({
      method: 'GET',
      url: '/v1/auth/session',
      headers: { cookie: sessionCookie },
    });
    expect(session.statusCode).toBe(200);
    const { csrfToken } = session.json<{ csrfToken: string }>();
    return {
      cookie: sessionCookie,
      headers: {
        cookie: sessionCookie,
        origin: 'http://127.0.0.1:3000',
        'x-shopai-csrf': csrfToken,
        'content-type': 'application/json',
      },
    };
  };

  const sha256 = (value: string) =>
    createHash('sha256').update(value, 'utf8').digest('hex');

  const insertPairingRow = async (options: {
    merchantId: string;
    userId: string;
    storeUrl: string;
    token: string;
    status?: 'pending' | 'consumed';
    expiresAt?: Date;
  }) => {
    const [row] = await database.db
      .insert(connectionPairings)
      .values({
        merchantId: options.merchantId,
        provider: 'woocommerce',
        createdBy: options.userId,
        tokenHash: sha256(options.token),
        storeUrl: options.storeUrl,
        status: options.status ?? 'pending',
        expiresAt: options.expiresAt ?? new Date(Date.now() + 15 * 60_000),
      })
      .returning({ id: connectionPairings.id });
    return row;
  };

  const completeBody = (
    overrides: Partial<{
      siteUrl: string;
      siteName: string;
      storeUrl: string;
      consumerKey: string;
      consumerSecret: string;
    }> = {},
  ) => ({
    siteUrl: overrides.siteUrl ?? storeUrlA,
    siteName: overrides.siteName ?? 'Pairing A Store',
    wpVersion: '6.7.1',
    wooVersion: '11.1.0',
    credentials: {
      storeUrl: overrides.storeUrl ?? storeUrlA,
      consumerKey: overrides.consumerKey ?? rawConsumerKey,
      consumerSecret: overrides.consumerSecret ?? rawConsumerSecret,
    },
  });

  const completePairing = (
    token: string,
    body: ReturnType<typeof completeBody>,
  ) =>
    app.inject({
      method: 'POST',
      url: completeEndpoint,
      headers: {
        'x-shopai-pairing-token': token,
        'content-type': 'application/json',
      },
      payload: body,
    });

  const auditEvents = async (merchantId: string) =>
    withTenant(database.db, merchantId, async (tx) =>
      tx
        .select({
          event: connectionAudit.event,
          actor: connectionAudit.actor,
          result: connectionAudit.result,
          detail: connectionAudit.detail,
          connectionId: connectionAudit.connectionId,
          merchantId: connectionAudit.merchantId,
          createdAt: connectionAudit.createdAt,
        })
        .from(connectionAudit)
        .where(eq(connectionAudit.merchantId, merchantId)),
    );

  beforeAll(async () => {
    await rm(uploadDir, { recursive: true, force: true });
    await queue.obliterate({ force: true });
    await database.db.execute(
      sql`truncate table ${connectionAudit}, ${connectionPairings}, ${connections}, ${connectorSecrets}, ${connectorSecretAudit}, ${memberships}, ${sessions}, ${users}, ${merchants} cascade`,
    );
    app = await buildApp(undefined, env, {
      onboardingConnectorFactory: pairingConnectorFactory,
      connectorSecretBackend: secretBackend,
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
      payload: { name: 'Pairing A' },
    });
    expect(setup.statusCode).toBe(201);
    merchantAId = setup.json<{ merchant: { id: string } }>().merchant.id;
    const [owner] = await database.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email));
    ownerUserId = owner.id;

    const inserted = await database.db
      .insert(users)
      .values([
        { email: 'woo-pairing-editor@test.example' },
        { email: 'woo-pairing-viewer@test.example' },
        { email: 'woo-pairing-shopper@test.example' },
        { email: 'woo-pairing-bowner@test.example' },
      ])
      .returning({ id: users.id, email: users.email });
    // account_status/email_verified_at are raw-migration columns (0031);
    // merchant sessions only authenticate for verified, active users.
    await database.db.execute(sql`
      UPDATE users
      SET account_status = 'active', email_verified_at = now()
      WHERE email IN (
        'woo-pairing-editor@test.example',
        'woo-pairing-viewer@test.example',
        'woo-pairing-shopper@test.example',
        'woo-pairing-bowner@test.example'
      )
    `);
    const byEmail = new Map(inserted.map((row) => [row.email, row.id]));
    editorUserId = byEmail.get('woo-pairing-editor@test.example')!;
    viewerUserId = byEmail.get('woo-pairing-viewer@test.example')!;
    shopperUserId = byEmail.get('woo-pairing-shopper@test.example')!;
    const merchantBUserId = byEmail.get('woo-pairing-bowner@test.example')!;
    await database.db.insert(memberships).values([
      { merchantId: merchantAId, userId: editorUserId, role: 'editor' },
      { merchantId: merchantAId, userId: viewerUserId, role: 'viewer' },
    ]);
    merchantBId = randomUUID();
    await bootstrapMerchant(database.db, {
      userId: merchantBUserId,
      merchantId: merchantBId,
      name: 'Pairing B',
      slug: `pairing-b-${merchantBId.slice(0, 8)}`,
    });
    editorAuth = await authContextFor(editorUserId);
  });

  beforeEach(() => {
    okFetch.mockClear();
    unauthorizedFetch.mockClear();
    redirectFetch.mockClear();
  });

  afterAll(async () => {
    await app.close();
    await queue.obliterate({ force: true });
    await queue.close();
    await database.close();
    await rm(uploadDir, { recursive: true, force: true });
  });

  describe.sequential('woocommerce secure pairing lifecycle', () => {
    it('1. allows the owner to create a pairing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: pairingEndpoint(merchantAId),
        headers: { cookie, 'content-type': 'application/json' },
        payload: { storeUrl: storeUrlA },
      });
      expect(response.statusCode).toBe(201);
      const body = response.json<{
        pairing: {
          pairingToken: string;
          expiresAt: string;
          storeUrl: string;
          provider: string;
        };
      }>();
      expect(body.pairing.pairingToken).toMatch(/^[A-Za-z0-9_-]{43}$/u);
      expect(body.pairing.provider).toBe('woocommerce');
      expect(body.pairing.storeUrl).toBe(storeUrlA);
      const ttlMinutes =
        (new Date(body.pairing.expiresAt).getTime() - Date.now()) / 60_000;
      expect(ttlMinutes).toBeGreaterThan(0);
      expect(ttlMinutes).toBeLessThanOrEqual(15);
      const events = await auditEvents(merchantAId);
      expect(
        events.some(
          (row) => row.event === 'pairing_created' && row.result === 'success',
        ),
      ).toBe(true);
      // Pairing token is stored only as a hash.
      const [row] = await database.db
        .select({ tokenHash: connectionPairings.tokenHash })
        .from(connectionPairings)
        .limit(1);
      expect(row.tokenHash).toBe(sha256(body.pairing.pairingToken));
      expect(row.tokenHash).not.toContain(body.pairing.pairingToken);
    });

    it('2. allows an editor to create a pairing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: pairingEndpoint(merchantAId),
        headers: editorAuth.headers,
        payload: { storeUrl: storeUrlC },
      });
      expect(response.statusCode).toBe(201);
    });

    it('3. rejects a viewer', async () => {
      const viewerAuth = await authContextFor(viewerUserId);
      const response = await app.inject({
        method: 'POST',
        url: pairingEndpoint(merchantAId),
        headers: viewerAuth.headers,
        payload: { storeUrl: storeUrlB },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json<{ code: string }>().code).toBe('FORBIDDEN');
    });

    it('4. rejects a shopper', async () => {
      const shopperCookie = await issueSession(shopperUserId, 'shopper');
      const session = await app.inject({
        method: 'GET',
        url: '/v1/auth/session',
        headers: { cookie: shopperCookie },
      });
      const { csrfToken } = session.json<{ csrfToken: string }>();
      const response = await app.inject({
        method: 'POST',
        url: pairingEndpoint(merchantAId),
        headers: {
          cookie: shopperCookie,
          origin: 'http://127.0.0.1:3000',
          'x-shopai-csrf': csrfToken,
          'content-type': 'application/json',
        },
        payload: { storeUrl: storeUrlB },
      });
      expect(response.statusCode).toBe(403);
    });

    it('23. enforces CSRF on browser pairing mutations', async () => {
      const withoutCsrf = await app.inject({
        method: 'POST',
        url: pairingEndpoint(merchantAId),
        headers: {
          cookie: editorAuth.cookie,
          origin: 'http://127.0.0.1:3000',
          'content-type': 'application/json',
        },
        payload: { storeUrl: storeUrlB },
      });
      expect(withoutCsrf.statusCode).toBe(403);
      expect(withoutCsrf.json<{ code: string }>().code).toBe('CSRF_REJECTED');
    });

    it('8. rejects plugin requests without a valid pairing token', async () => {
      const noHeader = await app.inject({
        method: 'POST',
        url: completeEndpoint,
        headers: { 'content-type': 'application/json' },
        payload: completeBody(),
      });
      expect(noHeader.statusCode).toBe(404);
      expect(noHeader.json<{ code: string }>().code).toBe('PAIRING_INVALID');
      const malformed = await completePairing('short-token', completeBody());
      expect(malformed.statusCode).toBe(404);
      const unknown = await completePairing(
        randomBytes(32).toString('base64url'),
        completeBody(),
      );
      expect(unknown.statusCode).toBe(404);
      const events = await auditEvents(merchantAId);
      expect(
        events.filter((row) => row.event === 'pairing_rejected').length,
      ).toBe(0);
    });

    it('5. rejects an expired pairing', async () => {
      const token = randomBytes(32).toString('base64url');
      const pairingRow = await insertPairingRow({
        merchantId: merchantAId,
        userId: ownerUserId,
        storeUrl: storeUrlB,
        token,
        expiresAt: new Date(Date.now() - 60_000),
      });
      const response = await completePairing(
        token,
        completeBody({ siteUrl: storeUrlB, storeUrl: storeUrlB }),
      );
      expect(response.statusCode).toBe(404);
      expect(response.json<{ code: string }>().code).toBe('PAIRING_INVALID');
      const [status] = await database.db
        .select({ status: connectionPairings.status })
        .from(connectionPairings)
        .where(eq(connectionPairings.id, pairingRow.id));
      expect(status.status).toBe('expired');
      const events = await auditEvents(merchantAId);
      expect(
        events.some(
          (row) =>
            row.event === 'pairing_rejected' &&
            row.detail?.reason === 'expired',
        ),
      ).toBe(true);
    });

    it('9. completes a valid pairing into a pending connection and consumes the pairing once', async () => {
      const createResponse = await app.inject({
        method: 'POST',
        url: pairingEndpoint(merchantAId),
        headers: { cookie, 'content-type': 'application/json' },
        payload: { storeUrl: storeUrlA },
      });
      expect(createResponse.statusCode).toBe(201);
      const { pairing } = createResponse.json<{
        pairing: { pairingToken: string; id: string };
      }>();

      const response = await completePairing(
        pairing.pairingToken,
        completeBody(),
      );
      expect(response.statusCode).toBe(201);
      const body = response.json<{
        connection: {
          id: string;
          provider: string;
          authorizationStatus: string;
          syncMode: string;
        };
        store: { url: string; name: string };
        mode: string;
      }>();
      expect(body.connection.provider).toBe('woocommerce');
      expect(body.connection.authorizationStatus).toBe('pending');
      expect(body.connection.syncMode).toBe('incremental');
      expect(body.mode).toBe('connected');
      expect(body.store.url).toBe(storeUrlA);
      expect(body.store.name).toBe('Pairing A Store');

      const [connection] = await withTenant(
        database.db,
        merchantAId,
        async (tx) =>
          tx
            .select()
            .from(connections)
            .where(eq(connections.id, body.connection.id)),
      );
      expect(connection.merchantId).toBe(merchantAId);
      expect(connection.provider).toBe('woocommerce');
      expect(connection.authorizationStatus).toBe('pending');
      expect(connection.connectedVia).toBe('plugin_pairing');
      expect(connection.storeUrl).toBe(storeUrlA);
      expect(connection.storeName).toBe('Pairing A Store');

      const [secret] = await withTenant(database.db, merchantAId, async (tx) =>
        tx
          .select()
          .from(connectorSecrets)
          .where(eq(connectorSecrets.connectionId, body.connection.id)),
      );
      expect(secret.version).toBe(1);
      expect(secret.status).toBe('active');
      expect(secret.reference).toBe(connection.credentialsRef);

      const [pairingAfter] = await database.db
        .select()
        .from(connectionPairings)
        .where(eq(connectionPairings.id, pairing.id));
      expect(pairingAfter.status).toBe('consumed');
      expect(pairingAfter.consumedConnectionId).toBe(body.connection.id);
      expect(pairingAfter.consumedAt).not.toBeNull();

      // 11. Raw credential never appears in the response.
      expect(response.body).not.toContain(rawConsumerKey);
      expect(response.body).not.toContain(rawConsumerSecret);
    });

    it('13. resolves the connection secret through the managed reference', async () => {
      const [connection] = await withTenant(
        database.db,
        merchantAId,
        async (tx) =>
          tx
            .select()
            .from(connections)
            .where(
              and(
                eq(connections.merchantId, merchantAId),
                eq(connections.storeUrl, storeUrlA),
              ),
            ),
      );
      expect(connection.credentialsRef).toMatch(
        /^secret:\/\/ONBOARDING_[A-F0-9]{32}$/u,
      );
      const resolved = await secretBackend.resolveScoped(
        connection.credentialsRef!,
        {
          merchantId: merchantAId,
          connectionId: connection.id,
          provider: 'woocommerce',
        },
      );
      expect(resolved).toEqual({
        storeUrl: storeUrlA,
        consumerKey: rawConsumerKey,
        consumerSecret: rawConsumerSecret,
      });
    });

    it('12. keeps raw credentials out of DB rows and queue payloads', async () => {
      const [connection] = await withTenant(
        database.db,
        merchantAId,
        async (tx) =>
          tx
            .select()
            .from(connections)
            .where(
              and(
                eq(connections.merchantId, merchantAId),
                eq(connections.storeUrl, storeUrlA),
              ),
            ),
      );
      const serializedRows: string[] = [];
      for (const query of [
        database.db.select().from(connections),
        database.db.select().from(connectorSecrets),
        database.db.select().from(connectorSecretAudit),
        database.db.select().from(connectionAudit),
        database.db.select().from(connectionPairings),
      ]) {
        serializedRows.push(JSON.stringify(await query));
      }
      for (const value of [rawConsumerKey, rawConsumerSecret]) {
        for (const row of serializedRows) expect(row).not.toContain(value);
      }
      const jobs = await queue.getJobs([
        'waiting',
        'active',
        'delayed',
        'completed',
        'failed',
      ]);
      const pairingJob = jobs.find(
        (job) => job.id === `pairing-${connection.id}`,
      );
      expect(pairingJob).toBeDefined();
      expect(JSON.stringify(pairingJob?.data)).not.toContain(rawConsumerKey);
      expect(JSON.stringify(pairingJob?.data)).not.toContain(rawConsumerSecret);
      expect(pairingJob?.data).toMatchObject({
        merchantId: merchantAId,
        connectionId: connection.id,
      });
    });

    it('6. rejects replayed pairings', async () => {
      const createResponse = await app.inject({
        method: 'POST',
        url: pairingEndpoint(merchantAId),
        headers: { cookie, 'content-type': 'application/json' },
        payload: { storeUrl: storeUrlB },
      });
      const { pairing } = createResponse.json<{
        pairing: { pairingToken: string; id: string };
      }>();
      const first = await completePairing(
        pairing.pairingToken,
        completeBody({ siteUrl: storeUrlB, storeUrl: storeUrlB }),
      );
      expect(first.statusCode).toBe(201);
      const replay = await completePairing(
        pairing.pairingToken,
        completeBody({ siteUrl: storeUrlB, storeUrl: storeUrlB }),
      );
      expect(replay.statusCode).toBe(404);
      const events = await auditEvents(merchantAId);
      expect(
        events.some(
          (row) =>
            row.event === 'pairing_rejected' && row.detail?.reason === 'replay',
        ),
      ).toBe(true);
      // Only one connection exists for store B.
      const rows = await withTenant(database.db, merchantAId, async (tx) =>
        tx
          .select()
          .from(connections)
          .where(eq(connections.storeUrl, storeUrlB)),
      );
      expect(rows).toHaveLength(1);
    });

    it('7. binds the pairing to its own merchant and cannot be carried elsewhere', async () => {
      const createResponse = await app.inject({
        method: 'POST',
        url: pairingEndpoint(merchantAId),
        headers: { cookie, 'content-type': 'application/json' },
        payload: { storeUrl: storeUrlB },
      });
      const { pairing } = createResponse.json<{
        pairing: { pairingToken: string };
      }>();
      const response = await completePairing(
        pairing.pairingToken,
        completeBody({ siteUrl: storeUrlB, storeUrl: storeUrlB }),
      );
      expect(response.statusCode).toBe(201); // same merchant: reconnect path
      const body = response.json<{ connection: { id: string } }>();
      const [connection] = await withTenant(
        database.db,
        merchantAId,
        async (tx) =>
          tx
            .select()
            .from(connections)
            .where(eq(connections.id, body.connection.id)),
      );
      // The connection always lands under the pairing's merchant: the
      // complete endpoint has no merchant parameter and the pairing row is
      // the only merchant binding.
      expect(connection.merchantId).toBe(merchantAId);
      const merchantBConnections = await withTenant(
        database.db,
        merchantBId,
        async (tx) =>
          tx
            .select()
            .from(connections)
            .where(eq(connections.merchantId, merchantBId)),
      );
      expect(merchantBConnections).toHaveLength(0);
      // Reusing the consumed token from another context stays rejected.
      const replay = await completePairing(
        pairing.pairingToken,
        completeBody({ siteUrl: storeUrlB, storeUrl: storeUrlB }),
      );
      expect(replay.statusCode).toBe(404);
    });

    it('10. does not create an active connection for an invalid credential', async () => {
      const secretCountBefore = (
        await database.db
          .select({ id: connectorSecrets.id })
          .from(connectorSecrets)
          .where(
            and(
              eq(connectorSecrets.merchantId, merchantAId),
              eq(connectorSecrets.provider, 'woocommerce'),
            ),
          )
      ).length;
      const createResponse = await app.inject({
        method: 'POST',
        url: pairingEndpoint(merchantAId),
        headers: { cookie, 'content-type': 'application/json' },
        payload: { storeUrl: storeUrlB },
      });
      const { pairing } = createResponse.json<{
        pairing: { pairingToken: string; id: string };
      }>();
      const response = await completePairing(
        pairing.pairingToken,
        completeBody({
          siteUrl: storeUrlB,
          storeUrl: storeUrlB,
          consumerKey: rawConsumerKey,
          consumerSecret: 'cs_invalid_pairing_secret_value',
        }),
      );
      expect(response.statusCode).toBe(422);
      expect(response.json<{ code: string }>().code).toBe('CONNECTION_FAILED');
      const rows = await withTenant(database.db, merchantAId, async (tx) =>
        tx
          .select()
          .from(connections)
          .where(eq(connections.storeUrl, storeUrlB)),
      );
      // Only the previously created valid connection exists; no new one.
      expect(rows).toHaveLength(1);
      const [pairingAfter] = await database.db
        .select()
        .from(connectionPairings)
        .where(eq(connectionPairings.id, pairing.id));
      expect(pairingAfter.status).toBe('pending');
      const events = await auditEvents(merchantAId);
      expect(
        events.some(
          (row) =>
            row.event === 'validation_failed' && row.result === 'failure',
        ),
      ).toBe(true);
      const secretCount = await database.db
        .select({ id: connectorSecrets.id })
        .from(connectorSecrets)
        .where(
          and(
            eq(connectorSecrets.merchantId, merchantAId),
            eq(connectorSecrets.provider, 'woocommerce'),
          ),
        );
      expect(secretCount).toHaveLength(secretCountBefore);
    });

    it('20. rejects loopback/private store targets (SSRF)', async () => {
      const createResponse = await app.inject({
        method: 'POST',
        url: pairingEndpoint(merchantAId),
        headers: { cookie, 'content-type': 'application/json' },
        payload: { storeUrl: 'https://127.0.0.1' },
      });
      expect(createResponse.statusCode).toBe(201);
      const { pairing } = createResponse.json<{
        pairing: { pairingToken: string };
      }>();
      const response = await completePairing(
        pairing.pairingToken,
        completeBody({
          siteUrl: 'https://127.0.0.1',
          storeUrl: 'https://127.0.0.1',
        }),
      );
      expect(response.statusCode).toBe(422);
      const rows = await withTenant(database.db, merchantAId, async (tx) =>
        tx
          .select()
          .from(connections)
          .where(eq(connections.storeUrl, 'https://127.0.0.1')),
      );
      expect(rows).toHaveLength(0);
      const events = await auditEvents(merchantAId);
      expect(events.some((row) => row.event === 'validation_failed')).toBe(
        true,
      );
    });

    it('21. rejects stores whose validation redirects (no private-IP escape)', async () => {
      const createResponse = await app.inject({
        method: 'POST',
        url: pairingEndpoint(merchantAId),
        headers: { cookie, 'content-type': 'application/json' },
        payload: { storeUrl: 'https://redirect.example' },
      });
      const { pairing } = createResponse.json<{
        pairing: { pairingToken: string };
      }>();
      const response = await completePairing(
        pairing.pairingToken,
        completeBody({
          siteUrl: 'https://redirect.example',
          storeUrl: 'https://redirect.example',
        }),
      );
      expect(response.statusCode).toBe(422);
      expect(redirectFetch).toHaveBeenCalled();
      const rows = await withTenant(database.db, merchantAId, async (tx) =>
        tx
          .select()
          .from(connections)
          .where(eq(connections.storeUrl, 'https://redirect.example')),
      );
      expect(rows).toHaveLength(0);
    });

    it('15. produces an explicit conflict for duplicate store ownership', async () => {
      // A already owns store A (connected above). Merchant B cannot pair it.
      const pairingB = await app.inject({
        method: 'POST',
        url: pairingEndpoint(merchantBId),
        headers: { cookie, 'content-type': 'application/json' },
        payload: { storeUrl: 'https://pairing-a.example:443/' },
      });
      // The pilot cookie belongs to A's owner; B requires B's owner session.
      expect(pairingB.statusCode).toBe(403);
      const [merchantBUserId] = (
        await database.db
          .select({ userId: memberships.userId })
          .from(memberships)
          .where(
            and(
              eq(memberships.merchantId, merchantBId),
              eq(memberships.role, 'owner'),
            ),
          )
      ).map((row) => row.userId);
      const authB = await authContextFor(merchantBUserId);
      const createB = await app.inject({
        method: 'POST',
        url: pairingEndpoint(merchantBId),
        headers: authB.headers,
        payload: { storeUrl: 'https://pairing-a.example:443/' },
      });
      expect(createB.statusCode).toBe(409);
      expect(createB.json<{ code: string }>().code).toBe(
        'STORE_OWNERSHIP_CONFLICT',
      );

      // Completion-time race: B and A both hold pending pairings for store
      // D; B completes first, and A's completion must hit the partial unique
      // index and produce an explicit conflict — never a silent second owner.
      const storeUrlD = 'https://pairing-d.example';
      const pairingDForB = await app.inject({
        method: 'POST',
        url: pairingEndpoint(merchantBId),
        headers: authB.headers,
        payload: { storeUrl: storeUrlD },
      });
      expect(pairingDForB.statusCode).toBe(201);
      const pairingDForA = await app.inject({
        method: 'POST',
        url: pairingEndpoint(merchantAId),
        headers: { cookie, 'content-type': 'application/json' },
        payload: { storeUrl: storeUrlD },
      });
      expect(pairingDForA.statusCode).toBe(201);
      const completeDForB = await completePairing(
        pairingDForB.json<{ pairing: { pairingToken: string } }>().pairing
          .pairingToken,
        completeBody({ siteUrl: storeUrlD, storeUrl: storeUrlD }),
      );
      expect(completeDForB.statusCode).toBe(201);
      const completeDForA = await completePairing(
        pairingDForA.json<{ pairing: { pairingToken: string } }>().pairing
          .pairingToken,
        completeBody({ siteUrl: storeUrlD, storeUrl: storeUrlD }),
      );
      expect(completeDForA.statusCode).toBe(409);
      expect(completeDForA.json<{ code: string }>().code).toBe(
        'STORE_OWNERSHIP_CONFLICT',
      );
      const events = await auditEvents(merchantAId);
      expect(
        events.some(
          (row) =>
            row.event === 'pairing_rejected' &&
            row.detail?.reason === 'store_conflict',
        ),
      ).toBe(true);
      // Exactly one owner: one connection under B, none under A.
      const dRows = await database.db
        .select({ merchantId: connections.merchantId })
        .from(connections)
        .where(eq(connections.storeUrl, storeUrlD));
      expect(dRows).toHaveLength(1);
      expect(dRows[0].merchantId).toBe(merchantBId);
    });

    it('22. normalizes equivalent store URLs so duplicates never appear', async () => {
      const storeUrlE = 'https://pairing-e.example';
      // First pairing uses an equivalent spelling of the same store URL.
      const createOdd = await app.inject({
        method: 'POST',
        url: pairingEndpoint(merchantAId),
        headers: { cookie, 'content-type': 'application/json' },
        payload: { storeUrl: 'https://PAIRING-E.example:443/' },
      });
      expect(createOdd.statusCode).toBe(201);
      expect(
        createOdd.json<{ pairing: { storeUrl: string } }>().pairing.storeUrl,
      ).toBe(storeUrlE);
      const first = await completePairing(
        createOdd.json<{ pairing: { pairingToken: string } }>().pairing
          .pairingToken,
        completeBody({
          siteUrl: storeUrlE,
          storeUrl: storeUrlE,
          consumerKey: rawRotatedKey,
          consumerSecret: rawRotatedSecret,
        }),
      );
      expect(first.statusCode).toBe(201);
      expect(first.json<{ mode: string }>().mode).toBe('connected');
      // Second pairing with the plain spelling reconnects instead of
      // creating a duplicate connection.
      const createPlain = await app.inject({
        method: 'POST',
        url: pairingEndpoint(merchantAId),
        headers: { cookie, 'content-type': 'application/json' },
        payload: { storeUrl: storeUrlE },
      });
      expect(createPlain.statusCode).toBe(201);
      const second = await completePairing(
        createPlain.json<{ pairing: { pairingToken: string } }>().pairing
          .pairingToken,
        completeBody({
          siteUrl: storeUrlE,
          storeUrl: storeUrlE,
        }),
      );
      expect(second.statusCode).toBe(201);
      expect(second.json<{ mode: string }>().mode).toBe('reconnected');
      const rows = await withTenant(database.db, merchantAId, async (tx) =>
        tx
          .select()
          .from(connections)
          .where(
            and(
              eq(connections.provider, 'woocommerce'),
              eq(connections.storeUrl, storeUrlE),
            ),
          ),
      );
      expect(rows).toHaveLength(1);
    });

    it('16. rotates the active reference on a valid reconnect', async () => {
      const [before] = await withTenant(database.db, merchantAId, async (tx) =>
        tx
          .select()
          .from(connections)
          .where(
            and(
              eq(connections.merchantId, merchantAId),
              eq(connections.storeUrl, storeUrlA),
            ),
          ),
      );
      expect(before.authorizationStatus).toBe('pending');
      const createResponse = await app.inject({
        method: 'POST',
        url: pairingEndpoint(merchantAId),
        headers: { cookie, 'content-type': 'application/json' },
        payload: { storeUrl: 'https://pairing-a.example/' },
      });
      expect(createResponse.statusCode).toBe(201);
      const { pairing } = createResponse.json<{
        pairing: { pairingToken: string };
      }>();
      const response = await completePairing(
        pairing.pairingToken,
        completeBody({
          consumerKey: rawRotatedKey,
          consumerSecret: rawRotatedSecret,
        }),
      );
      expect(response.statusCode).toBe(201);
      const body = response.json<{
        mode: string;
        connection: { id: string; authorizationStatus: string };
      }>();
      expect(body.mode).toBe('reconnected');
      expect(body.connection.id).toBe(before.id);
      expect(body.connection.authorizationStatus).toBe('active');

      const [after] = await withTenant(database.db, merchantAId, async (tx) =>
        tx.select().from(connections).where(eq(connections.id, before.id)),
      );
      expect(after.credentialsRef).not.toBe(before.credentialsRef);
      expect(after.authorizationStatus).toBe('active');
      const secrets = await withTenant(database.db, merchantAId, async (tx) =>
        tx
          .select()
          .from(connectorSecrets)
          .where(eq(connectorSecrets.connectionId, before.id))
          .orderBy(connectorSecrets.version),
      );
      expect(secrets).toHaveLength(2);
      expect(secrets[0].status).toBe('rotated');
      expect(secrets[0].reference).toBe(before.credentialsRef);
      expect(secrets[1].status).toBe('active');
      expect(secrets[1].reference).toBe(after.credentialsRef);
      const workerScope = {
        merchantId: merchantAId,
        connectionId: before.id,
        provider: 'woocommerce',
      };
      expect(secretBackend.entries.get(after.credentialsRef!)?.scope).toEqual(
        workerScope,
      );
      const workerResolver = new EnvironmentSecretResolver({}, secretBackend);
      await expect(
        workerResolver.resolve(after.credentialsRef!, workerScope),
      ).resolves.toEqual({
        storeUrl: storeUrlA,
        consumerKey: rawRotatedKey,
        consumerSecret: rawRotatedSecret,
      });
      await expect(
        workerResolver.resolve(after.credentialsRef!, {
          ...workerScope,
          connectionId: randomUUID(),
        }),
      ).rejects.toThrow('secret scope mismatch');
      const events = await auditEvents(merchantAId);
      expect(events.some((row) => row.event === 'connection_reconnected')).toBe(
        true,
      );
      // The old reference must no longer resolve to the new credentials.
      const oldResolved = await secretBackend.resolveScoped(
        before.credentialsRef!,
        {
          merchantId: merchantAId,
          connectionId: before.id,
          provider: 'woocommerce',
        },
      );
      expect(oldResolved).toEqual({
        storeUrl: storeUrlA,
        consumerKey: rawConsumerKey,
        consumerSecret: rawConsumerSecret,
      });
    });

    it('17. keeps the old active reference when a reconnect fails', async () => {
      const [before] = await withTenant(database.db, merchantAId, async (tx) =>
        tx
          .select()
          .from(connections)
          .where(
            and(
              eq(connections.merchantId, merchantAId),
              eq(connections.storeUrl, storeUrlA),
            ),
          ),
      );
      const secretsBefore = (
        await withTenant(database.db, merchantAId, async (tx) =>
          tx
            .select()
            .from(connectorSecrets)
            .where(eq(connectorSecrets.connectionId, before.id)),
        )
      ).length;
      const createResponse = await app.inject({
        method: 'POST',
        url: pairingEndpoint(merchantAId),
        headers: { cookie, 'content-type': 'application/json' },
        payload: { storeUrl: storeUrlA },
      });
      const { pairing } = createResponse.json<{
        pairing: { pairingToken: string };
      }>();
      const failed = await completePairing(
        pairing.pairingToken,
        completeBody({
          consumerKey: rawConsumerKey,
          consumerSecret: 'cs_invalid_reconnect_secret_value',
        }),
      );
      expect(failed.statusCode).toBe(422);
      const [after] = await withTenant(database.db, merchantAId, async (tx) =>
        tx.select().from(connections).where(eq(connections.id, before.id)),
      );
      expect(after.credentialsRef).toBe(before.credentialsRef);
      expect(after.authorizationStatus).toBe('active');
      const secrets = await withTenant(database.db, merchantAId, async (tx) =>
        tx
          .select()
          .from(connectorSecrets)
          .where(eq(connectorSecrets.connectionId, before.id)),
      );
      expect(secrets).toHaveLength(secretsBefore); // no new version was created
      expect(secrets.every((row) => row.status !== 'revoked')).toBe(true);
      await expect(
        new EnvironmentSecretResolver({}, secretBackend).resolve(
          before.credentialsRef!,
          {
            merchantId: merchantAId,
            connectionId: before.id,
            provider: 'woocommerce',
          },
        ),
      ).resolves.toEqual({
        storeUrl: storeUrlA,
        consumerKey: rawRotatedKey,
        consumerSecret: rawRotatedSecret,
      });
    });

    it('14. isolates connections per merchant', async () => {
      const listA = await app.inject({
        method: 'GET',
        url: `/v1/merchants/${merchantAId}/connections`,
        headers: { cookie },
      });
      expect(listA.statusCode).toBe(200);
      // B's owner session gets 403 on A routes; B's own connections never
      // include A's rows (RLS tenant scoping).
      const [merchantBUserId] = (
        await database.db
          .select({ userId: memberships.userId })
          .from(memberships)
          .where(
            and(
              eq(memberships.merchantId, merchantBId),
              eq(memberships.role, 'owner'),
            ),
          )
      ).map((row) => row.userId);
      const authB = await authContextFor(merchantBUserId);
      const crossList = await app.inject({
        method: 'GET',
        url: `/v1/merchants/${merchantAId}/connections`,
        headers: authB.headers,
      });
      expect(crossList.statusCode).toBe(403);
      const listAIds = new Set(
        (
          await withTenant(database.db, merchantAId, async (tx) =>
            tx
              .select({ id: connections.id })
              .from(connections)
              .where(eq(connections.merchantId, merchantAId)),
          )
        ).map((row) => row.id),
      );
      const merchantBRows = await withTenant(
        database.db,
        merchantBId,
        async (tx) =>
          tx
            .select()
            .from(connections)
            .where(eq(connections.merchantId, merchantBId)),
      );
      expect(merchantBRows.every((row) => !listAIds.has(row.id))).toBe(true);
    });

    it('18. lets an editor disconnect and revoke the connection', async () => {
      const [target] = await withTenant(database.db, merchantAId, async (tx) =>
        tx
          .select()
          .from(connections)
          .where(
            and(
              eq(connections.merchantId, merchantAId),
              eq(connections.storeUrl, storeUrlA),
            ),
          ),
      );
      const response = await app.inject({
        method: 'DELETE',
        url: `/v1/merchants/${merchantAId}/connections/${target.id}`,
        headers: {
          cookie: editorAuth.cookie,
          origin: 'http://127.0.0.1:3000',
          'x-shopai-csrf': editorAuth.headers['x-shopai-csrf'],
        },
      });
      expect(response.statusCode).toBe(200);
      const [after] = await withTenant(database.db, merchantAId, async (tx) =>
        tx.select().from(connections).where(eq(connections.id, target.id)),
      );
      expect(after.authorizationStatus).toBe('revoked');
      expect(after.active).toBe(false);
      const secrets = await withTenant(database.db, merchantAId, async (tx) =>
        tx
          .select()
          .from(connectorSecrets)
          .where(eq(connectorSecrets.connectionId, target.id)),
      );
      // The previously active reference is revoked; older rotated versions
      // keep their historical status per the ÜRÜN-004 retention policy.
      expect(secrets.some((row) => row.status === 'active')).toBe(false);
      expect(secrets.find((row) => row.status === 'revoked')).toBeTruthy();
      const events = await auditEvents(merchantAId);
      expect(
        events.some(
          (row) =>
            row.event === 'connection_revoked' &&
            row.connectionId === target.id,
        ),
      ).toBe(true);
    });

    it('19. keeps revoked connections out of worker syncs', async () => {
      const [revoked] = await withTenant(database.db, merchantAId, async (tx) =>
        tx
          .select()
          .from(connections)
          .where(
            and(
              eq(connections.merchantId, merchantAId),
              eq(connections.authorizationStatus, 'revoked'),
            ),
          ),
      );
      const resolver = new EnvironmentSecretResolver(
        process.env,
        secretBackend,
      );
      const result = await syncCatalogConnection(
        database.db,
        { merchantId: merchantAId, connectionId: revoked.id },
        resolver,
        pairingConnectorFactory,
        () => new Date(),
        undefined,
        'pairing-worker-test',
        env.CONNECTOR_SECRET_BACKEND,
      );
      expect(result).toEqual({ skipped: true });
      const audits = await withTenant(database.db, merchantAId, async (tx) =>
        tx
          .select()
          .from(connectorSecretAudit)
          .where(
            and(
              eq(connectorSecretAudit.connectionId, revoked.id),
              eq(connectorSecretAudit.event, 'resolution_failed'),
            ),
          ),
      );
      expect(audits.length).toBeGreaterThan(0);
    });

    it('24. records audit events with actor, merchant, connection and no secret values', async () => {
      const events = await auditEvents(merchantAId);
      const eventNames = events.map((row) => row.event);
      for (const expected of [
        'pairing_created',
        'pairing_consumed',
        'pairing_rejected',
        'connection_created',
        'validation_failed',
        'connection_reconnected',
        'connection_revoked',
      ])
        expect(eventNames).toContain(expected);
      for (const row of events) {
        expect(row.actor).toBeTruthy();
        expect(row.merchantId).toBe(merchantAId);
        expect(row.createdAt).not.toBeNull();
        expect(['success', 'failure']).toContain(row.result);
      }
      const serialized = JSON.stringify(events);
      for (const value of [
        rawConsumerKey,
        rawConsumerSecret,
        rawRotatedKey,
        rawRotatedSecret,
      ])
        expect(serialized).not.toContain(value);
    });
  });
}
