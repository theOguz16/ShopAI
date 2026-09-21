import { randomUUID } from 'node:crypto';
import { count, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../apps/api/src/app.js';
import { parseApiEnv } from '../../apps/api/src/env.js';
import { createServices } from '../../apps/api/src/services.js';
import {
  connections,
  createDatabase,
  discoverySessions,
  importCatalog,
  interactionEvents,
  merchants,
  products,
} from '../../packages/db/src/index.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl)
  throw new Error('interaction-events.test için DATABASE_URL gerekli.');

describe.sequential('interaction event scope and idempotency', () => {
  const database = createDatabase(databaseUrl);
  const merchantId = 'f1000000-0000-4000-8000-000000000001';
  const connectionId = 'f1000000-0000-4000-8000-000000000002';
  const env = parseApiEnv({
    CATALOG_MODE: 'postgres',
    DATABASE_URL: databaseUrl,
    MCP_PUBLIC_ORIGIN: 'https://api.test.example',
    WIDGET_ORIGIN: 'https://widget.test.example',
    REDIRECT_SIGNING_SECRET: 'interaction-events-secret-000000000000000',
  });
  const services = createServices(env);
  let app: Awaited<ReturnType<typeof buildApp>>;
  let productId: string;

  beforeAll(async () => {
    await database.db.execute(
      sql`truncate table ${interactionEvents}, ${discoverySessions}, ${connections}, ${merchants} cascade`,
    );
    await database.db.insert(merchants).values({
      id: merchantId,
      name: 'Event Store',
      slug: 'event-store',
      active: true,
      isPublic: true,
    });
    await database.db
      .insert(connections)
      .values({ id: connectionId, merchantId, provider: 'csv' });
    await importCatalog(database.db, {
      schemaVersion: 1,
      runId: randomUUID(),
      merchantId,
      connectionId,
      observedAt: new Date().toISOString(),
      rows: [
        {
          externalId: 'event-offer',
          productKey: 'event-product',
          title: 'Event Product',
          description: '',
          category: 'tshirt',
          size: 'M',
          color: 'black',
          priceMinor: 1000,
          currency: 'TRY',
          available: true,
          checkoutUrl: 'https://merchant.example/product',
        },
      ],
    });
    await database.db
      .update(products)
      .set({ published: true })
      .where(eq(products.merchantId, merchantId));
    const [product] = await database.db
      .select({ id: products.id })
      .from(products)
      .where(eq(products.merchantId, merchantId));
    if (!product) throw new Error('fixture product missing');
    productId = product.id;
    app = await buildApp(services, env);
  });

  afterAll(async () => {
    await app.close();
    await database.close();
  });

  it('records web events once per session event key without accepting commerce events', async () => {
    const sessionResponse = await app.inject({
      method: 'POST',
      url: '/discovery-session',
      payload: { surface: 'web', merchant: merchantId },
    });
    const session = sessionResponse.json<{ id: string }>();
    const eventKey = randomUUID();
    const payload = {
      discoverySessionId: session.id,
      events: [
        { eventKey, type: 'category_selected', merchantId, category: 'tshirt' },
        {
          eventKey: randomUUID(),
          type: 'filter_applied',
          merchantId,
          filterKind: 'size',
        },
        {
          eventKey: randomUUID(),
          type: 'product_impression',
          merchantId,
          productId,
        },
      ],
    };
    const first = await app.inject({
      method: 'POST',
      url: '/v1/interaction-events',
      payload,
    });
    expect(first.statusCode).toBe(202);
    expect(first.json()).toEqual({ accepted: 3, duplicates: 0 });
    const retry = await app.inject({
      method: 'POST',
      url: '/v1/interaction-events',
      payload,
    });
    expect(retry.json()).toEqual({ accepted: 0, duplicates: 3 });
    const forged = await app.inject({
      method: 'POST',
      url: '/v1/interaction-events',
      payload: {
        discoverySessionId: session.id,
        events: [
          { eventKey: randomUUID(), type: 'conversion_received', merchantId },
        ],
      },
    });
    expect(forged.statusCode).toBe(400);
    const [stored] = await database.db
      .select({ value: count() })
      .from(interactionEvents);
    expect(stored?.value).toBe(3);
  });

  it('keeps save and alert creation history after current state is removed', async () => {
    const sessionResponse = await app.inject({
      method: 'POST',
      url: '/discovery-session',
      payload: { surface: 'web', merchant: merchantId },
    });
    const session = sessionResponse.json<{ id: string }>();
    const saved = await app.inject({
      method: 'POST',
      url: '/v1/saved-products',
      payload: { productId, discoverySessionId: session.id },
    });
    expect(saved.statusCode).toBe(201);
    const savedId = saved.json<{ item: { id: string } }>().item.id;
    const cookie = saved.headers['set-cookie'];
    const alert = await app.inject({
      method: 'POST',
      url: '/v1/product-alerts',
      headers: { cookie },
      payload: {
        productId,
        conditionType: 'PRICE_BELOW',
        targetValue: 900,
        email: 'event@example.com',
        discoverySessionId: session.id,
      },
    });
    expect(alert.statusCode).toBe(201);
    const alertId = alert.json<{ alert: { id: string } }>().alert.id;
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/v1/saved-products/${savedId}`,
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/v1/product-alerts/${alertId}`,
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(200);

    const rows = await database.db
      .select({ type: interactionEvents.eventType })
      .from(interactionEvents)
      .where(eq(interactionEvents.discoverySessionId, session.id));
    expect(rows.map((row) => row.type).sort()).toEqual([
      'alert_created',
      'product_saved',
    ]);
  });
});
