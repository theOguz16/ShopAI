import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../apps/api/src/app.js';
import { parseApiEnv } from '../../apps/api/src/env.js';
import { createServices } from '../../apps/api/src/services.js';
import { createDatabase } from '../../packages/db/src/client.js';
import { importCatalog } from '../../packages/db/src/import-catalog.js';
import {
  connections,
  memberships,
  merchants,
  products,
  searchEvents,
  users,
} from '../../packages/db/src/schema.js';

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase('search analytics intent taxonomy', () => {
  if (!databaseUrl) return;

  const merchantId = randomUUID();
  const connectionId = randomUUID();
  const ownerEmail = `metrics-${randomUUID()}@test.example`;
  const ownerToken = 'metrics-owner-pilot-token-000000000000';
  const env = parseApiEnv({
    CATALOG_MODE: 'postgres',
    DATABASE_URL: databaseUrl,
    MCP_PUBLIC_ORIGIN: 'https://api.metrics.test',
    WIDGET_ORIGIN: 'https://widget.metrics.test',
    REDIRECT_SIGNING_SECRET: 'metrics-redirect-secret-000000000000000000',
    AUTH_PILOT_CREDENTIALS: JSON.stringify({ [ownerEmail]: ownerToken }),
    UPLOAD_DIR: '/tmp/shopai-metrics-uploads',
  });
  const database = createDatabase(databaseUrl);
  const services = createServices(env);
  let app: Awaited<ReturnType<typeof buildApp>>;
  let cookie = '';
  let discoverySessionId = '';

  beforeAll(async () => {
    await database.db.insert(merchants).values({
      id: merchantId,
      name: 'Metrics Store',
      slug: `metrics-${randomUUID()}`,
      active: true,
      isPublic: true,
    });
    await database.db.insert(connections).values({
      id: connectionId,
      merchantId,
      provider: 'csv',
    });
    await importCatalog(database.db, {
      schemaVersion: 1,
      runId: randomUUID(),
      merchantId,
      connectionId,
      observedAt: new Date().toISOString(),
      rows: [
        {
          externalId: 'metrics-offer-a',
          productKey: 'metrics-product-a',
          title: 'Metric Alpha',
          description: '',
          category: 'metrics',
          size: 'M',
          color: 'Black',
          priceMinor: 10_000,
          currency: 'TRY',
          available: true,
          checkoutUrl: 'https://merchant.example/metrics-a',
        },
        {
          externalId: 'metrics-offer-b',
          productKey: 'metrics-product-b',
          title: 'Metric Beta',
          description: '',
          category: 'metrics',
          size: 'M',
          color: 'Black',
          priceMinor: 11_000,
          currency: 'TRY',
          available: true,
          checkoutUrl: 'https://merchant.example/metrics-b',
        },
      ],
    });
    await database.db
      .update(products)
      .set({ published: true })
      .where(eq(products.merchantId, merchantId));

    app = await buildApp(services, env);
    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: ownerEmail, token: ownerToken },
    });
    expect(login.statusCode).toBe(200);
    cookie = login.headers['set-cookie']?.split(';')[0] ?? '';
    const [owner] = await database.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, ownerEmail));
    if (!owner) throw new Error('Metrics owner oluşturulamadı.');
    await database.db.insert(memberships).values({
      userId: owner.id,
      merchantId,
      role: 'owner',
    });

    const session = await app.inject({
      method: 'POST',
      url: '/discovery-session',
      payload: { surface: 'brand_widget', merchant: merchantId },
    });
    expect(session.statusCode).toBe(201);
    discoverySessionId = session.json().id as string;
  });

  afterAll(async () => {
    await app.close();
    await database.close();
  });

  it('keeps catalog loads and pagination out of user-search KPIs', async () => {
    const catalogLoad = await app.inject({
      method: 'POST',
      url: `/v1/stores/${merchantId}/search`,
      payload: {
        query: '',
        filters: { sizes: [], inStockOnly: false },
        discoverySessionId,
        analyticsIntent: 'catalog_load',
        limit: 1,
      },
    });
    expect(catalogLoad.statusCode).toBe(200);

    const explicitSearch = await app.inject({
      method: 'POST',
      url: `/v1/stores/${merchantId}/search`,
      payload: {
        query: 'Metric',
        filters: { sizes: [], inStockOnly: false },
        discoverySessionId,
        analyticsIntent: 'explicit_search',
        limit: 1,
      },
    });
    expect(explicitSearch.statusCode).toBe(200);
    const cursor = explicitSearch.json().nextCursor as string | null;
    expect(cursor).toBeTruthy();

    const pagination = await app.inject({
      method: 'POST',
      url: `/v1/stores/${merchantId}/search`,
      payload: {
        query: 'Metric',
        filters: { sizes: [], inStockOnly: false },
        discoverySessionId,
        analyticsIntent: 'catalog_load',
        cursor,
        limit: 1,
      },
    });
    expect(pagination.statusCode).toBe(200);

    const refinement = await app.inject({
      method: 'POST',
      url: `/v1/stores/${merchantId}/search`,
      payload: {
        query: 'Alpha',
        filters: { sizes: [], inStockOnly: false },
        discoverySessionId,
        analyticsIntent: 'refinement',
      },
    });
    expect(refinement.statusCode).toBe(200);

    const rows = await database.db
      .select({
        intent: searchEvents.intent,
        requestKind: searchEvents.requestKind,
      })
      .from(searchEvents)
      .where(eq(searchEvents.merchantId, merchantId))
      .orderBy(searchEvents.occurredAt);
    expect(rows.map((row) => row.intent)).toEqual([
      'catalog_load',
      'explicit_search',
      'pagination',
      'refinement',
    ]);
    expect(rows.map((row) => row.requestKind)).toEqual([
      'initial',
      'initial',
      'pagination',
      'initial',
    ]);

    const analytics = await app.inject({
      method: 'GET',
      url: `/v1/merchants/${merchantId}/analytics`,
      headers: { cookie },
    });
    expect(analytics.statusCode).toBe(200);
    expect(analytics.json().metrics).toMatchObject({
      aiSearches: 2,
      searchAttempts: 2,
      catalogLoads: 1,
      explicitSearches: 1,
      refinements: 1,
      paginationRequests: 1,
      searchesBySurface: { brand_widget: 2 },
      catalogLoadsBySurface: { brand_widget: 1 },
    });
  });
});
