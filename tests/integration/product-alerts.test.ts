import { randomUUID } from 'node:crypto';
import type { LiveCatalogConnector } from '@shopai/connectors';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../apps/api/src/app.js';
import { parseApiEnv } from '../../apps/api/src/env.js';
import { createServices } from '../../apps/api/src/services.js';
import type { AlertEmailSender } from '../../apps/worker/src/product-alerts.js';
import { syncCatalogConnection } from '../../apps/worker/src/sync.js';
import { createDatabase } from '../../packages/db/src/client.js';
import { importCatalog } from '../../packages/db/src/import-catalog.js';
import {
  anonymousShoppingProfiles,
  connections,
  merchantCredentialOwnerships,
  merchants,
  productAlertNotifications,
  productAlerts,
  products,
  variants,
} from '../../packages/db/src/index.js';

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

function cookieFrom(response: { headers: Record<string, unknown> }) {
  const value = response.headers['set-cookie'];
  const header = Array.isArray(value) ? value[0] : value;
  return typeof header === 'string' ? header.split(';')[0] : '';
}

function mcpPayload(name: string, arguments_: Record<string, unknown> = {}) {
  return {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name, arguments: arguments_ },
  };
}

function connectorForPrice(input: {
  priceMinor: number;
  available?: boolean;
  observedAt: string;
}): LiveCatalogConnector {
  return {
    provider: 'woocommerce',
    capabilities: { liveInventory: true, incrementalSync: true },
    async validate() {},
    async readPage() {
      return {
        rows: [
          {
            externalId: 'alert-offer-m-black',
            productKey: 'alert-tshirt',
            title: 'Alert Tişört',
            description: 'Price / stock alert integration fixture',
            category: 'tshirt',
            size: 'M',
            color: 'black',
            priceMinor: input.priceMinor,
            currency: 'TRY',
            available: input.available ?? true,
            checkoutUrl: 'https://merchant.example/alert-tshirt',
          },
        ],
        nextCursor: null,
        sourceObservedAt: input.observedAt,
        fetchedAt: input.observedAt,
        complete: true,
      };
    },
  };
}

describeWithDatabase('product price / stock alerts', () => {
  if (!databaseUrl) return;

  const env = parseApiEnv({
    CATALOG_MODE: 'postgres',
    DATABASE_URL: databaseUrl,
    MCP_PUBLIC_ORIGIN: 'https://api.test.example',
    WIDGET_ORIGIN: 'https://widget.test.example',
    REDIRECT_SIGNING_SECRET: 'product-alert-redirect-secret-0000000000000',
    CONVERSION_CALLBACK_SECRET: 'product-alert-conversion-secret-000000000',
    UPLOAD_DIR: '/tmp/shopai-product-alert-uploads',
  });
  const database = createDatabase(databaseUrl);
  const services = createServices(env);
  const merchantId = 'fb000000-0000-4000-8000-000000000001';
  const connectionId = 'fb000000-0000-4000-8000-000000000002';
  const credentialsRef = 'secret://ALERT_TEST_WOO';
  const sent: Array<{ to: string; subject: string; text: string }> = [];
  const sender: AlertEmailSender = {
    async send(message) {
      sent.push(message);
    },
  };
  const secrets = { async resolve() { return {}; } };

  let app: Awaited<ReturnType<typeof buildApp>>;
  let anonymousCookie = '';
  let productId = '';
  let variantId = '';

  beforeAll(async () => {
    await database.db.execute(
      sql`truncate table ${productAlertNotifications}, ${productAlerts}, ${anonymousShoppingProfiles}, ${connections}, ${merchants} cascade`,
    );
    await database.db.insert(merchants).values({
      id: merchantId,
      name: 'Product Alert Merchant',
      slug: `product-alert-${randomUUID()}`,
      active: true,
      isPublic: true,
    });
    await database.db.insert(connections).values({
      id: connectionId,
      merchantId,
      provider: 'woocommerce',
      credentialsRef,
      authorizationStatus: 'active',
      syncMode: 'full',
    });
    await database.db.insert(merchantCredentialOwnerships).values({
      merchantId,
      provider: 'woocommerce',
      credentialsRef,
    });
    await importCatalog(database.db, {
      schemaVersion: 1,
      runId: randomUUID(),
      merchantId,
      connectionId,
      observedAt: '2026-09-11T18:00:00.000Z',
      rows: [
        {
          externalId: 'alert-offer-m-black',
          productKey: 'alert-tshirt',
          title: 'Alert Tişört',
          description: 'Price / stock alert integration fixture',
          category: 'tshirt',
          size: 'M',
          color: 'black',
          priceMinor: 2500,
          currency: 'TRY',
          available: true,
          checkoutUrl: 'https://merchant.example/alert-tshirt',
        },
      ],
    });
    const [product] = await database.db
      .select({ id: products.id })
      .from(products)
      .where(eq(products.merchantId, merchantId));
    const [variant] = await database.db
      .select({ id: variants.id })
      .from(variants)
      .where(eq(variants.merchantId, merchantId));
    productId = product?.id ?? '';
    variantId = variant?.id ?? '';
    if (!productId || !variantId)
      throw new Error('Product alert fixture oluşturulamadı.');
    await database.db
      .update(products)
      .set({ published: true })
      .where(eq(products.id, productId));
    app = await buildApp(services, env);
    const profile = await app.inject({
      method: 'GET',
      url: '/v1/shopping-profile',
    });
    anonymousCookie = cookieFrom(profile);
  });

  afterAll(async () => {
    await app.close();
    await database.close();
  });

  it('triggers PRICE_BELOW 2000 exactly once after worker sync changes 2500 → 1900', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/v1/product-alerts',
      headers: { cookie: anonymousCookie },
      payload: {
        productId,
        variantId,
        conditionType: 'PRICE_BELOW',
        targetValue: 2000,
        email: 'alert-user@test.example',
      },
    });
    expect(create.statusCode).toBe(201);
    const alertId = create.json().alert.id;

    const firstSync = await syncCatalogConnection(
      database.db,
      { merchantId, connectionId },
      secrets,
      () =>
        connectorForPrice({
          priceMinor: 1900,
          observedAt: '2026-09-11T19:00:00.000Z',
        }),
      () => new Date('2026-09-11T19:00:01.000Z'),
      sender,
    );
    expect(firstSync.skipped).toBe(false);
    expect(firstSync.alertEvaluation).toEqual(
      expect.objectContaining({ evaluated: 1, triggered: 1, delivered: 1 }),
    );

    const [triggered] = await database.db
      .select()
      .from(productAlerts)
      .where(eq(productAlerts.id, alertId));
    expect(triggered?.status).toBe('TRIGGERED');
    expect(triggered?.triggeredAt).not.toBeNull();
    expect(sent).toHaveLength(1);

    const secondSync = await syncCatalogConnection(
      database.db,
      { merchantId, connectionId },
      secrets,
      () =>
        connectorForPrice({
          priceMinor: 1900,
          observedAt: '2026-09-11T20:00:00.000Z',
        }),
      () => new Date('2026-09-11T20:00:01.000Z'),
      sender,
    );
    expect(secondSync.skipped).toBe(false);
    expect(secondSync.alertEvaluation).toEqual(
      expect.objectContaining({ evaluated: 0, triggered: 0, delivered: 0 }),
    );
    expect(sent).toHaveLength(1);

    const notifications = await database.db
      .select()
      .from(productAlertNotifications)
      .where(eq(productAlertNotifications.alertId, alertId));
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.status).toBe('SENT');
  });

  it('supports MCP creation on the same shopper identity without ChatGPT notifications', async () => {
    await database.db
      .update(products)
      .set({ published: true })
      .where(eq(products.id, productId));
    const response = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        accept: 'application/json, text/event-stream',
        cookie: anonymousCookie,
      },
      payload: mcpPayload('create_product_alert', {
        productId,
        variantId,
        conditionType: 'BACK_IN_STOCK',
        email: 'stock-user@test.example',
      }),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().result.structuredContent.alert).toEqual(
      expect.objectContaining({
        productId,
        variantId,
        conditionType: 'BACK_IN_STOCK',
        status: 'ACTIVE',
        channel: 'email',
      }),
    );
  });
});
