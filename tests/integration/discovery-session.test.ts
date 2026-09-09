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

describeWithDatabase('discovery sessions', () => {
  if (!databaseUrl) return;

  const env = parseApiEnv({
    CATALOG_MODE: 'postgres',
    DATABASE_URL: databaseUrl,
    MCP_PUBLIC_ORIGIN: 'https://api.test.example',
    WIDGET_ORIGIN: 'https://widget.test.example',
    REDIRECT_SIGNING_SECRET: 'discovery-session-redirect-secret-00000000000',
    UPLOAD_DIR: '/tmp/shopai-discovery-session-uploads',
  });
  const database = createDatabase(databaseUrl);
  const services = createServices(env);
  const maviId = 'da000000-0000-4000-8000-000000000001';
  const otherId = 'db000000-0000-4000-8000-000000000001';
  const connectionId = 'da000000-0000-4000-8000-000000000002';
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    await database.db.execute(
      sql`truncate table ${redirectClicks}, ${searchEvents}, ${discoverySessions}, ${connections}, ${merchants} cascade`,
    );
    await database.db.insert(merchants).values([
      {
        id: maviId,
        name: 'Mavi',
        slug: 'mavi',
        active: true,
        isPublic: true,
      },
      {
        id: otherId,
        name: 'Other',
        slug: 'other',
        active: true,
        isPublic: true,
      },
    ]);
    await database.db.insert(connections).values({
      id: connectionId,
      merchantId: maviId,
      provider: 'csv',
    });
    await importCatalog(database.db, {
      schemaVersion: 1,
      runId: randomUUID(),
      merchantId: maviId,
      connectionId,
      observedAt: new Date().toISOString(),
      rows: [
        {
          externalId: 'mavi-offer',
          productKey: 'mavi-product',
          title: 'Mavi Ürün',
          description: 'Instagram discovery ürünü',
          category: 'test',
          size: 'M',
          color: 'Mavi',
          priceMinor: 10_000,
          currency: 'TRY',
          available: true,
          checkoutUrl: 'https://merchant.example/mavi-product',
        },
      ],
    });
    await database.db
      .update(products)
      .set({ published: true })
      .where(eq(products.merchantId, maviId));
    app = await buildApp(services, env);
  });

  afterAll(async () => {
    await app.close();
    await database.close();
  });

  it('resolves redirect discovery attribution server-side without exposing session id in the token', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/discovery-session',
      payload: {
        merchant: 'mavi',
        surface: 'web',
        campaign: 'instagram_bio',
        referrer: 'https://instagram.com/mavi',
      },
    });
    expect(created.statusCode).toBe(201);
    const session = created.json<{
      id: string;
      surface: string;
      transport: string;
      merchantScope: string[];
      campaign: string;
      userId: string | null;
    }>();
    expect(session).toMatchObject({
      surface: 'web',
      transport: 'rest',
      merchantScope: [maviId],
      campaign: 'instagram_bio',
      userId: null,
    });

    const search = await app.inject({
      method: 'POST',
      url: `/v1/stores/${maviId}/search`,
      payload: { query: 'Mavi Ürün', discoverySessionId: session.id },
    });
    expect(search.statusCode).toBe(200);
    const searchBody = search.json<{
      searchId: string;
      items: Array<{ checkoutUrl: string }>;
    }>();
    expect(searchBody.items).toHaveLength(1);

    const [searchEvent] = await database.db
      .select({
        searchId: searchEvents.searchId,
        discoverySessionId: searchEvents.discoverySessionId,
      })
      .from(searchEvents)
      .where(eq(searchEvents.searchId, searchBody.searchId));
    expect(searchEvent).toEqual({
      searchId: searchBody.searchId,
      discoverySessionId: session.id,
    });

    const redirectPath = new URL(searchBody.items[0]?.checkoutUrl ?? '')
      .pathname;
    const token = redirectPath.slice('/r/'.length);
    const payloadPart = token.split('.')[0] ?? '';
    const tokenPayload = JSON.parse(
      Buffer.from(payloadPart, 'base64url').toString('utf8'),
    );
    expect(tokenPayload).toMatchObject({
      searchId: searchBody.searchId,
      transport: 'rest',
      surface: 'web',
    });
    expect(tokenPayload).not.toHaveProperty('discoverySessionId');
    expect(JSON.stringify(tokenPayload)).not.toContain(session.id);

    const redirect = await app.inject({
      method: 'GET',
      url: redirectPath,
      headers: { 'user-agent': 'Mozilla/5.0 ShopAI discovery test' },
    });
    expect(redirect.statusCode).toBe(302);

    const [click] = await database.db
      .select({
        searchId: redirectClicks.searchId,
        discoverySessionId: redirectClicks.discoverySessionId,
      })
      .from(redirectClicks)
      .where(eq(redirectClicks.searchId, searchBody.searchId));
    expect(click).toEqual({
      searchId: searchBody.searchId,
      discoverySessionId: session.id,
    });

    const outsideScope = await app.inject({
      method: 'POST',
      url: `/v1/stores/${otherId}/search`,
      payload: { query: 'anything', discoverySessionId: session.id },
    });
    expect(outsideScope.statusCode).toBe(403);
  });

  it('uses an empty merchant scope for network-wide discovery', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/discovery-session',
      payload: { surface: 'web' },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      surface: 'web',
      transport: 'rest',
      merchantScope: [],
    });
  });

  it.each(['chatgpt', 'gemini'])(
    'rejects %s on the REST discovery-session endpoint',
    async (surface) => {
      const response = await app.inject({
        method: 'POST',
        url: '/discovery-session',
        payload: { surface },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        code: 'INVALID_SURFACE_FOR_TRANSPORT',
      });
    },
  );

  it('accepts brand_widget on the REST discovery-session endpoint', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/discovery-session',
      payload: { surface: 'brand_widget' },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      surface: 'brand_widget',
      transport: 'rest',
    });
  });
});
