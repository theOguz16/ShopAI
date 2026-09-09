import { createHmac, randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../apps/api/src/app.js';
import { parseApiEnv } from '../../apps/api/src/env.js';
import { createServices } from '../../apps/api/src/services.js';
import { createDatabase } from '../../packages/db/src/client.js';
import { importCatalog } from '../../packages/db/src/import-catalog.js';
import {
  connections,
  conversionOrders,
  importRuns,
  memberships,
  merchants,
  offers,
  redirectClicks,
  searchEvents,
  users,
} from '../../packages/db/src/schema.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('analytics.test için DATABASE_URL gerekli.');
const secret = 'ci-conversion-callback-secret-0000000000000000';
const env = parseApiEnv({
  CATALOG_MODE: 'postgres',
  DATABASE_URL: databaseUrl,
  MCP_PUBLIC_ORIGIN: 'https://api.test.example',
  WIDGET_ORIGIN: 'https://widget.test.example',
  REDIRECT_SIGNING_SECRET: 'analytics-redirect-secret-00000000000000000',
  CONVERSION_CALLBACK_SECRET: secret,
  AUTH_PILOT_CREDENTIALS: JSON.stringify({
    'owner@analytics.test': 'analytics-owner-pilot-token',
    'other@analytics.test': 'analytics-other-pilot-token',
    'bootstrap@analytics.test': 'analytics-bootstrap-pilot-token',
  }),
  UPLOAD_DIR: '/tmp/shopai-analytics-uploads',
});
const database = createDatabase(databaseUrl);
const services = createServices(env);
const merchantA = 'ca000000-0000-4000-8000-000000000001';
const merchantB = 'cb000000-0000-4000-8000-000000000001';
const merchantCsv = 'cc000000-0000-4000-8000-000000000001';
const connectionA = 'ca000000-0000-4000-8000-000000000002';
const connectionB = 'cb000000-0000-4000-8000-000000000002';
let app: Awaited<ReturnType<typeof buildApp>>;
let cookie = '';
let offerId = '';
let webSearchId = '';

function signed(payload: object) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const merchantSecret = createHmac('sha256', secret)
    .update(merchantA)
    .digest();
  return {
    timestamp,
    signature: createHmac('sha256', merchantSecret)
      .update(`${timestamp}.${JSON.stringify(payload)}`)
      .digest('hex'),
  };
}

beforeAll(async () => {
  await database.db.execute(
    sql`truncate table ${conversionOrders}, ${redirectClicks}, ${searchEvents}, ${offers}, ${connections}, ${memberships}, ${users}, ${merchants} cascade`,
  );
  await database.db.insert(merchants).values([
    {
      id: merchantA,
      name: 'Analytics A',
      slug: `analytics-a-${randomUUID()}`,
      active: true,
    },
    {
      id: merchantB,
      name: 'Analytics B',
      slug: `analytics-b-${randomUUID()}`,
      active: true,
    },
    {
      id: merchantCsv,
      name: 'CSV Starter',
      slug: `csv-starter-${randomUUID()}`,
      active: true,
    },
  ]);
  await database.db.insert(connections).values([
    {
      id: connectionA,
      merchantId: merchantA,
      provider: 'csv',
      conversionTrackingEnabled: true,
    },
    {
      id: connectionB,
      merchantId: merchantB,
      provider: 'csv',
      conversionTrackingEnabled: true,
    },
  ]);
  await importCatalog(database.db, {
    schemaVersion: 1,
    runId: randomUUID(),
    merchantId: merchantA,
    connectionId: connectionA,
    observedAt: new Date().toISOString(),
    rows: [
      {
        externalId: 'analytics-offer',
        productKey: 'analytics-product',
        title: 'Ürün',
        description: '',
        category: 'test',
        size: 'M',
        color: 'Siyah',
        priceMinor: 10_000,
        currency: 'TRY',
        available: true,
        checkoutUrl: 'https://merchant.example/product',
      },
    ],
  });
  const [offer] = await database.db
    .select({ id: offers.id })
    .from(offers)
    .where(eq(offers.merchantId, merchantA));
  offerId = offer?.id ?? '';
  app = await buildApp(services, env);
  const login = await app.inject({
    method: 'POST',
    url: '/v1/auth/login',
    payload: {
      email: 'owner@analytics.test',
      token: 'analytics-owner-pilot-token',
    },
  });
  cookie = login.headers['set-cookie']?.split(';')[0] ?? '';
  const [user] = await database.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, 'owner@analytics.test'));
  if (!user || !offerId) throw new Error('Analytics test kurulumu başarısız.');
  await database.db.insert(memberships).values([
    { userId: user.id, merchantId: merchantA, role: 'owner' },
    { userId: user.id, merchantId: merchantCsv, role: 'owner' },
  ]);
  await database.db.insert(redirectClicks).values([
    {
      merchantId: merchantA,
      offerId,
      searchId: randomUUID(),
      transport: 'rest',
      surface: 'web',
      classification: 'human',
    },
    {
      merchantId: merchantA,
      offerId,
      searchId: randomUUID(),
      transport: 'rest',
      surface: 'web',
      classification: 'bot',
    },
  ]);
  await database.db.insert(searchEvents).values([
    {
      merchantId: merchantA,
      searchId: randomUUID(),
      transport: 'rest',
      surface: 'web',
      requestKind: 'initial',
      outcome: 'results',
    },
    {
      merchantId: merchantA,
      searchId: randomUUID(),
      transport: 'rest',
      surface: 'web',
      requestKind: 'initial',
      outcome: 'empty',
    },
    {
      merchantId: merchantA,
      transport: 'mcp',
      surface: 'chatgpt',
      requestKind: 'initial',
      outcome: 'error',
    },
    {
      merchantId: merchantA,
      searchId: randomUUID(),
      transport: 'mcp',
      surface: 'chatgpt',
      requestKind: 'pagination',
      outcome: 'results',
    },
    {
      merchantId: merchantB,
      searchId: randomUUID(),
      transport: 'rest',
      surface: 'web',
      requestKind: 'initial',
      outcome: 'results',
    },
  ]);
});

afterAll(async () => {
  await app.close();
  await database.close();
});

describe('tenant analytics and signed conversions', () => {
  it('records a web search as REST/web without persisting the raw query', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/v1/stores/${merchantA}/search`,
      payload: { query: 'saklanmaması gereken kullanıcı sorgusu' },
    });
    expect(response.statusCode).toBe(200);
    webSearchId = response.json<{ searchId: string }>().searchId;

    const rows = await database.db
      .select()
      .from(searchEvents)
      .where(eq(searchEvents.merchantId, merchantA));
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          merchantId: merchantA,
          searchId: webSearchId,
          transport: 'rest',
          surface: 'web',
          requestKind: 'initial',
          outcome: 'empty',
        }),
      ]),
    );
    expect(JSON.stringify(rows)).not.toContain('saklanmaması gereken');
  });

  it('records a ChatGPT search as MCP/chatgpt', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { accept: 'application/json, text/event-stream' },
      payload: {
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: {
          name: 'search_products',
          arguments: { query: 'Ürün', merchantIds: [merchantA] },
        },
      },
    });
    expect(response.statusCode).toBe(200);
    const searchId = response.json().result.structuredContent
      .searchId as string;
    const [row] = await database.db
      .select({
        transport: searchEvents.transport,
        surface: searchEvents.surface,
      })
      .from(searchEvents)
      .where(eq(searchEvents.searchId, searchId));
    expect(row).toEqual({ transport: 'mcp', surface: 'chatgpt' });
  });

  it('lists only the stores assigned to the authenticated user', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/merchants',
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().merchants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: merchantA, role: 'owner' }),
        expect.objectContaining({ id: merchantCsv, role: 'owner' }),
      ]),
    );
    expect(response.json().merchants).toHaveLength(2);
  });

  it('rejects a client-supplied merchant id without membership', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/merchants/f0000000-0000-4000-8000-000000000001/products',
      headers: { cookie },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ code: 'FORBIDDEN' });
  });

  it('does not accept another user email with a valid pilot code', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: {
        email: 'other@analytics.test',
        token: 'analytics-owner-pilot-token',
      },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ code: 'INVALID_CREDENTIALS' });
    expect(
      await database.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, 'other@analytics.test')),
    ).toEqual([]);
  });
  it('bootstraps merchant ownership atomically and only once', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: {
        email: 'bootstrap@analytics.test',
        token: 'analytics-bootstrap-pilot-token',
      },
    });
    const bootstrapCookie = login.headers['set-cookie']?.split(';')[0] ?? '';
    const first = await app.inject({
      method: 'POST',
      url: '/v1/setup/merchant',
      headers: { cookie: bootstrapCookie },
      payload: { name: 'Atomic Bootstrap' },
    });
    expect(first.statusCode).toBe(201);
    const merchantId = first.json<{ merchant: { id: string } }>().merchant.id;

    const second = await app.inject({
      method: 'POST',
      url: '/v1/setup/merchant',
      headers: { cookie: bootstrapCookie },
      payload: { name: 'Should Not Exist' },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json()).toEqual({ code: 'SETUP_ALREADY_COMPLETED' });

    const [bootstrapUser] = await database.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, 'bootstrap@analytics.test'));
    expect(bootstrapUser).toBeDefined();
    if (!bootstrapUser) throw new Error('Bootstrap kullanıcısı bulunamadı.');
    await expect(
      database.db
        .select({ merchantId: memberships.merchantId })
        .from(memberships)
        .where(eq(memberships.userId, bootstrapUser.id)),
    ).resolves.toEqual([{ merchantId }]);
  });
  it('lets a new CSV-only merchant upload without a pre-created connection', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/v1/merchants/${merchantCsv}/imports`,
      headers: { cookie, 'content-type': 'text/csv' },
      payload:
        'external_id,product_key,title,category,size,color,price_minor,currency,available,checkout_url\n' +
        'first,first,İlk Ürün,test,M,Siyah,10000,TRY,true,https://merchant.example/first',
    });

    expect(response.statusCode).toBe(202);
    const { runId } = response.json() as { runId: string };
    const [connection] = await database.db
      .select({
        id: connections.id,
        provider: connections.provider,
        authorizationStatus: connections.authorizationStatus,
      })
      .from(connections)
      .where(eq(connections.merchantId, merchantCsv));
    const [run] = await database.db
      .select({
        connectionId: importRuns.connectionId,
        filePath: importRuns.filePath,
      })
      .from(importRuns)
      .where(eq(importRuns.id, runId));

    expect(connection).toMatchObject({
      provider: 'csv',
      authorizationStatus: 'active',
    });
    expect(run?.connectionId).toBe(connection?.id);
    if (run?.filePath) await unlink(run.filePath);
  });
  it('is idempotent, preserves attribution, and applies refunds/cancellations', async () => {
    if (!webSearchId)
      throw new Error('Web search attribution fixture missing.');
    const paid = {
      orderId: 'order-1',
      status: 'paid',
      grossMinor: 10_000,
      refundedMinor: 0,
      currency: 'TRY',
      searchId: webSearchId,
      offerId,
      occurredAt: new Date(Date.now() - 2000).toISOString(),
    };
    for (const payload of [paid, paid]) {
      const auth = signed(payload);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: `/v1/conversions/${merchantA}/${connectionA}`,
            headers: {
              'x-shopai-timestamp': auth.timestamp,
              'x-shopai-signature': auth.signature,
            },
            payload,
          })
        ).statusCode,
      ).toBe(202);
    }
    const refunded = {
      ...paid,
      status: 'refunded',
      refundedMinor: 4_000,
      occurredAt: new Date().toISOString(),
    };
    const refundAuth = signed(refunded);
    await app.inject({
      method: 'POST',
      url: `/v1/conversions/${merchantA}/${connectionA}`,
      headers: {
        'x-shopai-timestamp': refundAuth.timestamp,
        'x-shopai-signature': refundAuth.signature,
      },
      payload: refunded,
    });
    const cancelled = {
      ...paid,
      orderId: 'order-2',
      status: 'cancelled',
      occurredAt: new Date().toISOString(),
    };
    const cancelAuth = signed(cancelled);
    await app.inject({
      method: 'POST',
      url: `/v1/conversions/${merchantA}/${connectionA}`,
      headers: {
        'x-shopai-timestamp': cancelAuth.timestamp,
        'x-shopai-signature': cancelAuth.signature,
      },
      payload: cancelled,
    });
    const unattributed = {
      orderId: 'order-without-shopai-attribution',
      status: 'paid',
      grossMinor: 900_000,
      refundedMinor: 0,
      currency: 'TRY',
      occurredAt: new Date().toISOString(),
    };
    const unattributedAuth = signed(unattributed);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/v1/conversions/${merchantA}/${connectionA}`,
          headers: {
            'x-shopai-timestamp': unattributedAuth.timestamp,
            'x-shopai-signature': unattributedAuth.signature,
          },
          payload: unattributed,
        })
      ).statusCode,
    ).toBe(202);
    const response = await app.inject({
      method: 'GET',
      url: `/v1/merchants/${merchantA}/analytics?timezone=Europe%2FIstanbul`,
      headers: { cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      measurement: 'measured',
      metrics: {
        searchAttempts: 5,
        successfulSearches: 4,
        emptySearches: 3,
        failedSearches: 1,
        paginationRequests: 1,
        noResultRate: 0.75,
        searchErrorRate: 0.2,
        searchesBySurface: { web: 3, chatgpt: 2 },
        searchesByChannel: { web: 3, chatgpt: 2 },
        humanRedirects: 1,
        botPreviews: 1,
        redirectsBySurface: { web: 1 },
        attributedSales: 1,
        netRevenueMinor: 6000,
        conversionRate: 1,
        incrementalSales: null,
      },
    });
    const orders = await database.db.select().from(conversionOrders);
    expect(orders).toHaveLength(3);
    expect(orders).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          externalOrderId: 'order-1',
          transport: 'rest',
          surface: 'web',
        }),
        expect.objectContaining({
          externalOrderId: 'order-without-shopai-attribution',
          transport: null,
          surface: null,
        }),
      ]),
    );
  });

  it('rejects invalid signatures and cross-tenant report access', async () => {
    const payload = {
      orderId: 'bad',
      status: 'paid',
      grossMinor: 1,
      currency: 'TRY',
      occurredAt: new Date().toISOString(),
    };
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/v1/conversions/${merchantA}/${connectionA}`,
          headers: {
            'x-shopai-timestamp': String(Math.floor(Date.now() / 1000)),
            'x-shopai-signature': 'bad',
          },
          payload,
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/v1/merchants/${merchantB}/analytics`,
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/v1/merchants/${merchantA}`,
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/v1/merchants/${merchantB}`,
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/v1/merchants/${merchantA}/connections`,
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/v1/merchants/${merchantB}/connections`,
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(403);
  });
});
