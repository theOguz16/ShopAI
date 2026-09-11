import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../apps/api/src/app.js';
import { parseApiEnv } from '../../apps/api/src/env.js';
import { createServices } from '../../apps/api/src/services.js';
import { createDatabase } from '../../packages/db/src/client.js';
import { importCatalog } from '../../packages/db/src/import-catalog.js';
import { productViewEvents } from '../../packages/db/src/product-view-event-repository.js';
import {
  connections,
  conversionOrders,
  memberships,
  merchants,
  offers,
  products,
  redirectClicks,
  searchEvents,
  users,
} from '../../packages/db/src/schema.js';

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase('merchant analytics dashboard', () => {
  if (!databaseUrl) return;

  const env = parseApiEnv({
    CATALOG_MODE: 'postgres',
    DATABASE_URL: databaseUrl,
    MCP_PUBLIC_ORIGIN: 'https://api.test.example',
    WIDGET_ORIGIN: 'https://widget.test.example',
    REDIRECT_SIGNING_SECRET: 'dashboard-redirect-secret-00000000000000000',
    CONVERSION_CALLBACK_SECRET: 'dashboard-conversion-secret-0000000000000000',
    AUTH_PILOT_CREDENTIALS: JSON.stringify({
      'owner@dashboard.test': 'dashboard-owner-pilot-token',
    }),
    UPLOAD_DIR: '/tmp/shopai-dashboard-uploads',
  });

  const database = createDatabase(databaseUrl);
  const services = createServices(env);
  const merchantA = 'ea000000-0000-4000-8000-000000000001';
  const merchantB = 'eb000000-0000-4000-8000-000000000001';
  const connectionA = 'ea000000-0000-4000-8000-000000000002';
  const connectionB = 'eb000000-0000-4000-8000-000000000002';
  const DAY_MS = 86_400_000;

  let app: Awaited<ReturnType<typeof buildApp>>;
  let cookie = '';
  let productA = '';
  let productB = '';
  let offerA = '';
  let offerB = '';
  let detailSearchId = '';

  beforeAll(async () => {
    await database.db.execute(
      sql`truncate table ${conversionOrders}, ${productViewEvents}, ${redirectClicks}, ${searchEvents}, ${connections}, ${memberships}, ${users}, ${merchants} cascade`,
    );
    await database.db.insert(merchants).values([
      {
        id: merchantA,
        name: 'Dashboard A',
        slug: `dashboard-a-${randomUUID()}`,
        active: true,
        isPublic: true,
      },
      {
        id: merchantB,
        name: 'Dashboard B',
        slug: `dashboard-b-${randomUUID()}`,
        active: true,
        isPublic: true,
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

    for (const [merchantId, connectionId, suffix] of [
      [merchantA, connectionA, 'a'],
      [merchantB, connectionB, 'b'],
    ] as const) {
      await importCatalog(database.db, {
        schemaVersion: 1,
        runId: randomUUID(),
        merchantId,
        connectionId,
        observedAt: new Date().toISOString(),
        rows: [
          {
            externalId: `dashboard-offer-${suffix}`,
            productKey: `dashboard-product-${suffix}`,
            title: `Dashboard Product ${suffix.toUpperCase()}`,
            description: '',
            category: 'dashboard',
            size: 'M',
            color: 'Siyah',
            priceMinor: 10_000,
            currency: 'TRY',
            available: true,
            checkoutUrl: `https://merchant.example/${suffix}`,
          },
        ],
      });
    }

    const [aProduct] = await database.db
      .select({ id: products.id })
      .from(products)
      .where(eq(products.merchantId, merchantA));
    const [bProduct] = await database.db
      .select({ id: products.id })
      .from(products)
      .where(eq(products.merchantId, merchantB));
    const [aOffer] = await database.db
      .select({ id: offers.id })
      .from(offers)
      .where(eq(offers.merchantId, merchantA));
    const [bOffer] = await database.db
      .select({ id: offers.id })
      .from(offers)
      .where(eq(offers.merchantId, merchantB));
    productA = aProduct?.id ?? '';
    productB = bProduct?.id ?? '';
    offerA = aOffer?.id ?? '';
    offerB = bOffer?.id ?? '';
    if (!productA || !productB || !offerA || !offerB)
      throw new Error('Dashboard katalog fixture oluşturulamadı.');

    await database.db
      .update(products)
      .set({ published: true })
      .where(eq(products.id, productA));
    await database.db
      .update(products)
      .set({ published: true })
      .where(eq(products.id, productB));

    app = await buildApp(services, env);
    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: {
        email: 'owner@dashboard.test',
        token: 'dashboard-owner-pilot-token',
      },
    });
    cookie = login.headers['set-cookie']?.split(';')[0] ?? '';
    const [user] = await database.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, 'owner@dashboard.test'));
    if (!user) throw new Error('Dashboard test kullanıcısı oluşturulamadı.');
    await database.db.insert(memberships).values({
      userId: user.id,
      merchantId: merchantA,
      role: 'owner',
    });
  });

  afterAll(async () => {
    await app.close();
    await database.close();
  });

  it('records successful product detail opens as product view events', async () => {
    detailSearchId = randomUUID();
    const response = await app.inject({
      method: 'GET',
      url: `/v1/products/${productA}/detail?searchId=${detailSearchId}`,
    });
    expect(response.statusCode).toBe(200);

    const [view] = await database.db
      .select()
      .from(productViewEvents)
      .where(
        and(
          eq(productViewEvents.merchantId, merchantA),
          eq(productViewEvents.searchId, detailSearchId),
        ),
      );
    expect(view).toMatchObject({
      merchantId: merchantA,
      productId: productA,
      searchId: detailSearchId,
      transport: 'rest',
      surface: 'web',
    });
  });

  it('computes the selected date range only from event and conversion rows', async () => {
    const now = Date.now();
    const inRange = new Date(now - 2 * 60 * 60_000);
    const old = new Date(now - 10 * DAY_MS);
    const from = new Date(now - 3 * DAY_MS);
    const to = new Date(now + 60_000);

    await database.db.insert(searchEvents).values([
      {
        merchantId: merchantA,
        searchId: randomUUID(),
        transport: 'rest',
        surface: 'web',
        requestKind: 'initial',
        outcome: 'results',
        occurredAt: inRange,
      },
      {
        merchantId: merchantA,
        searchId: randomUUID(),
        transport: 'mcp',
        surface: 'chatgpt',
        requestKind: 'initial',
        outcome: 'results',
        occurredAt: inRange,
      },
      {
        merchantId: merchantA,
        searchId: randomUUID(),
        transport: 'rest',
        surface: 'web',
        requestKind: 'initial',
        outcome: 'results',
        occurredAt: old,
      },
      {
        merchantId: merchantB,
        searchId: randomUUID(),
        transport: 'rest',
        surface: 'web',
        requestKind: 'initial',
        outcome: 'results',
        occurredAt: inRange,
      },
    ]);

    await database.db.insert(productViewEvents).values([
      {
        merchantId: merchantA,
        productId: productA,
        searchId: randomUUID(),
        transport: 'mcp',
        surface: 'chatgpt',
        occurredAt: inRange,
      },
      {
        merchantId: merchantA,
        productId: productA,
        searchId: randomUUID(),
        transport: 'rest',
        surface: 'web',
        occurredAt: old,
      },
      {
        merchantId: merchantB,
        productId: productB,
        searchId: randomUUID(),
        transport: 'rest',
        surface: 'web',
        occurredAt: inRange,
      },
    ]);

    const clickRows = [
      { surface: 'chatgpt', transport: 'mcp' },
      { surface: 'chatgpt', transport: 'mcp' },
      { surface: 'web', transport: 'rest' },
      { surface: 'brand_widget', transport: 'rest' },
    ] as const;
    await database.db.insert(redirectClicks).values(
      clickRows.map((row) => ({
        merchantId: merchantA,
        productId: productA,
        offerId: offerA,
        searchId: randomUUID(),
        transport: row.transport,
        surface: row.surface,
        classification: 'human' as const,
        occurredAt: inRange,
      })),
    );
    await database.db.insert(redirectClicks).values([
      {
        merchantId: merchantA,
        productId: productA,
        offerId: offerA,
        searchId: randomUUID(),
        transport: 'rest',
        surface: 'web',
        classification: 'bot',
        occurredAt: inRange,
      },
      {
        merchantId: merchantA,
        productId: productA,
        offerId: offerA,
        searchId: randomUUID(),
        transport: 'rest',
        surface: 'web',
        classification: 'human',
        occurredAt: old,
      },
      {
        merchantId: merchantB,
        productId: productB,
        offerId: offerB,
        searchId: randomUUID(),
        transport: 'rest',
        surface: 'web',
        classification: 'human',
        occurredAt: inRange,
      },
    ]);

    await database.db.insert(conversionOrders).values([
      {
        merchantId: merchantA,
        connectionId: connectionA,
        externalOrderId: 'dashboard-order-1',
        status: 'paid',
        currency: 'TRY',
        grossMinor: 10_000,
        refundedMinor: 0,
        searchId: randomUUID(),
        offerId: offerA,
        transport: 'mcp',
        surface: 'chatgpt',
        occurredAt: inRange,
      },
      {
        merchantId: merchantA,
        connectionId: connectionA,
        externalOrderId: 'dashboard-order-2',
        status: 'refunded',
        currency: 'TRY',
        grossMinor: 5_000,
        refundedMinor: 2_000,
        searchId: randomUUID(),
        offerId: offerA,
        transport: 'rest',
        surface: 'web',
        occurredAt: inRange,
      },
      {
        merchantId: merchantA,
        connectionId: connectionA,
        externalOrderId: 'dashboard-order-old',
        status: 'paid',
        currency: 'TRY',
        grossMinor: 99_000,
        refundedMinor: 0,
        searchId: randomUUID(),
        offerId: offerA,
        occurredAt: old,
      },
      {
        merchantId: merchantB,
        connectionId: connectionB,
        externalOrderId: 'dashboard-order-b',
        status: 'paid',
        currency: 'TRY',
        grossMinor: 88_000,
        refundedMinor: 0,
        searchId: randomUUID(),
        offerId: offerB,
        occurredAt: inRange,
      },
    ]);

    const response = await app.inject({
      method: 'GET',
      url:
        `/v1/merchants/${merchantA}/analytics?timezone=Europe%2FIstanbul` +
        `&from=${encodeURIComponent(from.toISOString())}` +
        `&to=${encodeURIComponent(to.toISOString())}`,
      headers: { cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      measurement: 'measured',
      metrics: {
        aiSearches: 2,
        productViews: 2,
        checkoutClicks: 4,
        orders: 2,
        attributedGmvMinor: 15_000,
        netRevenueMinor: 13_000,
        searchToCheckoutRate: 2,
        checkoutToOrderRate: 0.5,
        surfaceBreakdown: {
          counts: { chatgpt: 2, web: 1, other: 1 },
          shares: { chatgpt: 0.5, web: 0.25, other: 0.25 },
        },
      },
    });
  });

  it('rejects analytics access to a merchant without membership', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/merchants/${merchantB}/analytics`,
      headers: { cookie },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ code: 'FORBIDDEN' });
  });

  it('rejects ranges longer than the analytics window', async () => {
    const to = new Date();
    const from = new Date(to.getTime() - 94 * DAY_MS);
    const response = await app.inject({
      method: 'GET',
      url:
        `/v1/merchants/${merchantA}/analytics` +
        `?from=${encodeURIComponent(from.toISOString())}` +
        `&to=${encodeURIComponent(to.toISOString())}`,
      headers: { cookie },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ code: 'INVALID_RANGE' });
  });
});
