import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../apps/api/src/app.js';
import { parseApiEnv } from '../../apps/api/src/env.js';
import { createServices } from '../../apps/api/src/services.js';
import { signMerchantConversionRequest } from '../../packages/commerce/src/merchant-conversions.js';
import { MERCHANT_CONVERSION_HEADERS } from '../../packages/contracts/src/merchant-conversions.js';
import { createDatabase } from '../../packages/db/src/client.js';
import { importCatalog } from '../../packages/db/src/import-catalog.js';
import {
  connections,
  conversionOrders,
  discoverySessions,
  merchants,
  products,
  redirectClicks,
  searchEvents,
} from '../../packages/db/src/schema.js';

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase('merchant conversion callback', () => {
  if (!databaseUrl) return;

  const merchantId = 'dc000000-0000-4000-8000-000000000001';
  const connectionId = 'dc000000-0000-4000-8000-000000000002';
  const callbackSecret = 'merchant-conversion-root-secret-000000000000000';
  const env = parseApiEnv({
    CATALOG_MODE: 'postgres',
    DATABASE_URL: databaseUrl,
    MCP_PUBLIC_ORIGIN: 'https://api.test.example',
    WIDGET_ORIGIN: 'https://widget.test.example',
    REDIRECT_SIGNING_SECRET: 'merchant-conversion-redirect-secret-0000000000',
    CONVERSION_CALLBACK_SECRET: callbackSecret,
    UPLOAD_DIR: '/tmp/shopai-merchant-conversion-uploads',
  });
  const database = createDatabase(databaseUrl);
  const services = createServices(env);
  let app: Awaited<ReturnType<typeof buildApp>>;
  let clickId = '';
  let searchId = '';

  beforeAll(async () => {
    await database.db.execute(
      sql`truncate table ${conversionOrders}, ${redirectClicks}, ${searchEvents}, ${discoverySessions}, ${connections}, ${merchants} cascade`,
    );
    await database.db.insert(merchants).values({
      id: merchantId,
      name: 'Callback Merchant',
      slug: 'callback-merchant',
      active: true,
      isPublic: true,
    });
    await database.db.insert(connections).values({
      id: connectionId,
      merchantId,
      provider: 'csv',
      active: true,
      conversionTrackingEnabled: true,
    });
    await importCatalog(database.db, {
      schemaVersion: 1,
      runId: randomUUID(),
      merchantId,
      connectionId,
      observedAt: new Date().toISOString(),
      rows: [
        {
          externalId: 'callback-offer',
          productKey: 'callback-product',
          title: 'Callback Ürünü',
          description: '',
          category: 'test',
          size: 'M',
          color: 'Siyah',
          priceMinor: 149_900,
          currency: 'TRY',
          available: true,
          checkoutUrl: 'https://merchant.example/checkout?source=catalog',
        },
      ],
    });
    await database.db
      .update(products)
      .set({ published: true })
      .where(eq(products.merchantId, merchantId));
    app = await buildApp(services, env);

    const search = await app.inject({
      method: 'POST',
      url: `/v1/stores/${merchantId}/search`,
      payload: { query: 'Callback Ürünü', limit: 1 },
    });
    expect(search.statusCode).toBe(200);
    const searchBody = search.json<{
      searchId: string;
      products: Array<{ checkoutUrl: string }>;
    }>();
    searchId = searchBody.searchId;
    const redirectPath = new URL(
      searchBody.products[0]?.checkoutUrl ?? '',
    ).pathname;
    const redirect = await app.inject({
      method: 'GET',
      url: redirectPath,
      headers: { 'user-agent': 'Mozilla/5.0 merchant conversion test' },
    });
    expect(redirect.statusCode).toBe(302);
    const merchantUrl = new URL(redirect.headers.location ?? '');
    expect(merchantUrl.origin).toBe('https://merchant.example');
    expect(merchantUrl.searchParams.get('source')).toBe('catalog');
    clickId = merchantUrl.searchParams.get('shopai_click_id') ?? '';
    expect(clickId).toMatch(/^[0-9a-f-]{36}$/u);
  });

  afterAll(async () => {
    await app.close();
    await database.close();
  });

  function signedHeaders(payload: {
    clickId: string;
    orderId: string;
    orderValue: number;
    currency: 'TRY';
  }) {
    const timestamp = String(Math.floor(Date.now() / 1000));
    return {
      [MERCHANT_CONVERSION_HEADERS.merchantId]: merchantId,
      [MERCHANT_CONVERSION_HEADERS.timestamp]: timestamp,
      [MERCHANT_CONVERSION_HEADERS.signature]: signMerchantConversionRequest({
        rootSecret: callbackSecret,
        merchantId,
        timestamp,
        payload,
      }),
    };
  }

  it('is idempotent and links the sale to click, search and discovery session', async () => {
    const payload = {
      clickId,
      orderId: 'order-task-013',
      orderValue: 1499,
      currency: 'TRY' as const,
    };
    const first = await app.inject({
      method: 'POST',
      url: '/merchant/conversions',
      headers: signedHeaders(payload),
      payload,
    });
    expect(first.statusCode).toBe(201);
    const firstBody = first.json<{
      conversionId: string;
      duplicate: boolean;
      clickId: string;
      searchId: string;
      discoverySessionId: string | null;
      surface: string;
    }>();
    expect(firstBody).toMatchObject({
      duplicate: false,
      clickId,
      searchId,
      surface: 'web',
    });
    expect(firstBody.discoverySessionId).toMatch(/^[0-9a-f-]{36}$/u);

    const second = await app.inject({
      method: 'POST',
      url: '/merchant/conversions',
      headers: signedHeaders(payload),
      payload,
    });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({
      accepted: true,
      conversionId: firstBody.conversionId,
      duplicate: true,
      clickId,
      searchId,
    });

    const orders = await database.db
      .select({
        id: conversionOrders.id,
        externalOrderId: conversionOrders.externalOrderId,
        grossMinor: conversionOrders.grossMinor,
        clickId: conversionOrders.clickId,
        searchId: conversionOrders.searchId,
        discoverySessionId: conversionOrders.discoverySessionId,
        offerId: conversionOrders.offerId,
        transport: conversionOrders.transport,
        surface: conversionOrders.surface,
      })
      .from(conversionOrders)
      .where(
        and(
          eq(conversionOrders.merchantId, merchantId),
          eq(conversionOrders.externalOrderId, payload.orderId),
        ),
      );
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({
      id: firstBody.conversionId,
      externalOrderId: payload.orderId,
      grossMinor: 149_900,
      clickId,
      searchId,
      discoverySessionId: firstBody.discoverySessionId,
      transport: 'rest',
      surface: 'web',
    });

    const [click] = await database.db
      .select({
        searchId: redirectClicks.searchId,
        discoverySessionId: redirectClicks.discoverySessionId,
        offerId: redirectClicks.offerId,
      })
      .from(redirectClicks)
      .where(eq(redirectClicks.id, clickId));
    expect(click).toMatchObject({
      searchId: orders[0]?.searchId,
      discoverySessionId: orders[0]?.discoverySessionId,
      offerId: orders[0]?.offerId,
    });

    const [session] = await database.db
      .select({ id: discoverySessions.id })
      .from(discoverySessions)
      .where(
        eq(
          discoverySessions.id,
          orders[0]?.discoverySessionId ?? randomUUID(),
        ),
      );
    expect(session?.id).toBe(orders[0]?.discoverySessionId);
  });

  it('rejects an invalid signature without creating a sale', async () => {
    const payload = {
      clickId,
      orderId: 'order-invalid-signature',
      orderValue: 1499,
      currency: 'TRY' as const,
    };
    const response = await app.inject({
      method: 'POST',
      url: '/merchant/conversions',
      headers: {
        [MERCHANT_CONVERSION_HEADERS.merchantId]: merchantId,
        [MERCHANT_CONVERSION_HEADERS.timestamp]: String(
          Math.floor(Date.now() / 1000),
        ),
        [MERCHANT_CONVERSION_HEADERS.signature]: '0'.repeat(64),
      },
      payload,
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ code: 'INVALID_SIGNATURE' });
    expect(
      await database.db
        .select({ id: conversionOrders.id })
        .from(conversionOrders)
        .where(eq(conversionOrders.externalOrderId, payload.orderId)),
    ).toEqual([]);
  });

  it('rejects conflicting reuse of an existing order id', async () => {
    const payload = {
      clickId,
      orderId: 'order-task-013',
      orderValue: 1500,
      currency: 'TRY' as const,
    };
    const response = await app.inject({
      method: 'POST',
      url: '/merchant/conversions',
      headers: signedHeaders(payload),
      payload,
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ code: 'ORDER_ID_CONFLICT' });
  });
});
