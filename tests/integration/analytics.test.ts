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
  products,
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
let productId = '';
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
      isPublic: true,
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
  const [product] = await database.db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.merchantId, merchantA));
  offerId = offer?.id ?? '';
  productId = product?.id ?? '';
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
  if (!user || !offerId || !productId)
    throw new Error('Analytics test kurulumu başarısız.');
  await database.db.insert(memberships).values([
    { userId: user.id, merchantId: merchantA, role: 'owner' },
    { userId: user.id, merchantId: merchantCsv, role: 'owner' },
  ]);
  await database.db.insert(redirectClicks).values([
    {
      merchantId: merchantA,
      productId,
      offerId,
      searchId: randomUUID(),
      transport: 'rest',
      surface: 'web',
      campaign: 'instagram_bio',
      classification: 'human',
    },
    {
      merchantId: merchantA,
      productId,
      offerId,
      searchId: randomUUID(),
      transport: 'rest',
      surface: 'web',
      campaign: 'instagram_bio',
      classification: 'bot',
    },
  ]);
  await database.db.insert(searchEvents).values([
    {
      merchantId: merchantA,
      transport: 'rest',
      surface: 'web',
      requestKind: 'initial',
      outcome: 'results',
    },
  ]);
});

afterAll(async () => {
  await app.close();
  await services.close();
  await database.close();
  await unlink('/tmp/shopai-analytics-uploads').catch(() => undefined);
});

// Remaining tests intentionally unchanged.
