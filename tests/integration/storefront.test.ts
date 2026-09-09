import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../apps/api/src/app.js';
import { parseApiEnv } from '../../apps/api/src/env.js';
import { createServices } from '../../apps/api/src/services.js';
import { createDatabase } from '../../packages/db/src/client.js';
import { importCatalog } from '../../packages/db/src/import-catalog.js';
import {
  connections,
  discoverySessions,
  merchants,
  products,
  redirectClicks,
  searchEvents,
} from '../../packages/db/src/schema.js';

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase('branded storefront context', () => {
  if (!databaseUrl) return;

  const env = parseApiEnv({
    CATALOG_MODE: 'postgres',
    DATABASE_URL: databaseUrl,
    MCP_PUBLIC_ORIGIN: 'https://api.storefront.test',
    WIDGET_ORIGIN: 'https://widget.storefront.test',
    REDIRECT_SIGNING_SECRET: 'storefront-redirect-secret-000000000000000',
    UPLOAD_DIR: '/tmp/shopai-storefront-uploads',
    LOG_LEVEL: 'silent',
  });
  const database = createDatabase(databaseUrl);
  const services = createServices(env);
  const butikId = 'dc000000-0000-4000-8000-000000000001';
  const otherId = 'dd000000-0000-4000-8000-000000000001';
  const butikConnectionId = 'dc000000-0000-4000-8000-000000000002';
  const otherConnectionId = 'dd000000-0000-4000-8000-000000000002';
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    await database.db.execute(
      sql`truncate table ${redirectClicks}, ${searchEvents}, ${discoverySessions}, ${connections}, ${merchants} cascade`,
    );
    await database.db.insert(merchants).values([
      {
        id: butikId,
        name: 'Butik Luna Internal',
        slug: 'butik-luna',
        displayName: 'Butik Luna',
        logoUrl: 'https://cdn.example.com/butik-luna-logo.png',
        coverImageUrl: 'https://cdn.example.com/butik-luna-cover.jpg',
        primaryColor: '#6B4EFF',
        isPublic: true,
        active: true,
      },
      {
        id: otherId,
        name: 'Other Store',
        slug: 'other-store',
        displayName: 'Other Store',
        primaryColor: '#111111',
        isPublic: true,
        active: true,
      },
    ]);
    await database.db.insert(connections).values([
      {
        id: butikConnectionId,
        merchantId: butikId,
        provider: 'csv',
      },
      {
        id: otherConnectionId,
        merchantId: otherId,
        provider: 'csv',
      },
    ]);

    await importCatalog(database.db, {
      schemaVersion: 1,
      runId: randomUUID(),
      merchantId: butikId,
      connectionId: butikConnectionId,
      observedAt: new Date().toISOString(),
      rows: [
        {
          externalId: 'butik-luna-offer',
          productKey: 'butik-luna-product',
          title: 'Luna Elbise',
          description: 'Butik Luna ürünü',
          category: 'dress',
          size: 'M',
          color: 'Siyah',
          priceMinor: 12_000,
          currency: 'TRY',
          available: true,
          checkoutUrl: 'https://merchant.example/luna-elbise',
        },
      ],
    });
    await importCatalog(database.db, {
      schemaVersion: 1,
      runId: randomUUID(),
      merchantId: otherId,
      connectionId: otherConnectionId,
      observedAt: new Date().toISOString(),
      rows: [
        {
          externalId: 'other-offer',
          productKey: 'other-product',
          title: 'Other Elbise',
          description: 'Diğer mağaza ürünü',
          category: 'dress',
          size: 'M',
          color: 'Siyah',
          priceMinor: 13_000,
          currency: 'TRY',
          available: true,
          checkoutUrl: 'https://merchant.example/other-elbise',
        },
      ],
    });
    await database.db.update(products).set({ published: true });
    app = await buildApp(services, env);
  });

  afterAll(async () => {
    await app.close();
    await database.close();
  });

  it('returns public branded identity and starts merchant-scoped discovery', async () => {
    const storefrontResponse = await app.inject('/v1/storefronts/butik-luna');
    expect(storefrontResponse.statusCode).toBe(200);
    expect(storefrontResponse.json()).toEqual({
      storefront: {
        id: butikId,
        slug: 'butik-luna',
        displayName: 'Butik Luna',
        logoUrl: 'https://cdn.example.com/butik-luna-logo.png',
        coverImageUrl: 'https://cdn.example.com/butik-luna-cover.jpg',
        primaryColor: '#6B4EFF',
        isPublic: true,
      },
    });

    const sessionResponse = await app.inject({
      method: 'POST',
      url: '/discovery-session',
      payload: { surface: 'web', merchant: 'butik-luna' },
    });
    expect(sessionResponse.statusCode).toBe(201);
    const scopedSession = sessionResponse.json<{
      id: string;
      merchantScope: string[];
    }>();
    expect(scopedSession.merchantScope).toEqual([butikId]);

    const scopedSearch = await app.inject({
      method: 'POST',
      url: `/v1/stores/${butikId}/search`,
      payload: {
        query: 'elbise',
        discoverySessionId: scopedSession.id,
        filters: { inStockOnly: false },
      },
    });
    expect(scopedSearch.statusCode).toBe(200);
    expect(
      scopedSearch.json<{ items: Array<{ merchantId: string }> }>().items,
    ).toHaveLength(1);
    expect(
      scopedSearch.json<{ items: Array<{ merchantId: string }> }>().items[0]
        ?.merchantId,
    ).toBe(butikId);
  });

  it('removes storefront scope by creating a network-wide discovery session', async () => {
    const sessionResponse = await app.inject({
      method: 'POST',
      url: '/discovery-session',
      payload: { surface: 'web' },
    });
    expect(sessionResponse.statusCode).toBe(201);
    const networkSession = sessionResponse.json<{
      id: string;
      merchantScope: string[];
    }>();
    expect(networkSession.merchantScope).toEqual([]);

    const networkSearch = await app.inject({
      method: 'POST',
      url: '/v1/search',
      payload: {
        query: 'elbise',
        discoverySessionId: networkSession.id,
        filters: { inStockOnly: false },
      },
    });
    expect(networkSearch.statusCode).toBe(200);
    const merchantIds = networkSearch
      .json<{ items: Array<{ merchantId: string }> }>()
      .items.map((item) => item.merchantId);
    expect(merchantIds).toContain(butikId);
    expect(merchantIds).toContain(otherId);
  });

  it('does not expose private or inactive storefronts', async () => {
    await database.db
      .update(merchants)
      .set({ isPublic: false })
      .where(eq(merchants.id, otherId));
    expect((await app.inject('/v1/storefronts/other-store')).statusCode).toBe(
      404,
    );
  });
});
