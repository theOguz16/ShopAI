import { randomUUID } from 'node:crypto';
import { count, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../apps/api/src/app.js';
import { parseApiEnv } from '../../apps/api/src/env.js';
import { createServices } from '../../apps/api/src/services.js';
import { createDatabase } from '../../packages/db/src/client.js';
import { importCatalog } from '../../packages/db/src/import-catalog.js';
import { productViewEvents } from '../../packages/db/src/product-view-event-repository.js';
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
        {
          externalId: 'mavi-offer-2',
          productKey: 'mavi-product-2',
          title: 'Mavi Benzer Ürün',
          description: 'Attribution zinciri ürünü',
          category: 'test',
          size: 'L',
          color: 'Lacivert',
          priceMinor: 12_000,
          currency: 'TRY',
          available: true,
          checkoutUrl: 'https://merchant.example/mavi-similar-product',
        },
      ],
    });
    await database.db
      .update(products)
      .set({ published: true })
      .where(eq(products.merchantId, maviId));
    app = await buildApp(services, env);
  });

  it('creates a scoped context for a direct detail without manufacturing a search', async () => {
    const [product] = await database.db
      .select({ id: products.id })
      .from(products)
      .where(eq(products.externalKey, 'mavi-product'));
    expect(product).toBeDefined();

    const [before] = await database.db
      .select({ value: count() })
      .from(searchEvents);
    const detail = await app.inject({
      method: 'GET',
      url: `/v1/products/${product?.id}/detail`,
    });
    expect(detail.statusCode).toBe(200);
    const body = detail.json<{
      searchId: string;
      discoverySessionId: string;
      offers: Array<{ checkoutUrl: string | null }>;
    }>();
    expect(body.discoverySessionId).toMatch(/^[0-9a-f-]{36}$/u);

    const [after] = await database.db
      .select({ value: count() })
      .from(searchEvents);
    expect(after?.value).toBe(before?.value);

    const [view] = await database.db
      .select({
        searchId: productViewEvents.searchId,
        discoverySessionId: productViewEvents.discoverySessionId,
      })
      .from(productViewEvents)
      .where(eq(productViewEvents.searchId, body.searchId));
    expect(view).toEqual({
      searchId: body.searchId,
      discoverySessionId: body.discoverySessionId,
    });

    const redirect = await app.inject({
      method: 'GET',
      url: new URL(body.offers[0]?.checkoutUrl ?? '').pathname,
      headers: { 'user-agent': 'Mozilla/5.0 direct detail handoff' },
    });
    expect(redirect.statusCode).toBe(302);
    const [click] = await database.db
      .select({ discoverySessionId: redirectClicks.discoverySessionId })
      .from(redirectClicks)
      .where(eq(redirectClicks.searchId, body.searchId));
    expect(click?.discoverySessionId).toBe(body.discoverySessionId);
  });

  it('preserves campaign and session through search, detail, similar detail, and handoff', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/discovery-session',
      payload: {
        merchant: 'mavi',
        surface: 'web',
        campaign: 'SUMMER-2026',
      },
    });
    expect(created.statusCode).toBe(201);
    const session = created.json<{ id: string; campaign: string }>();
    expect(session.campaign).toBe('summer-2026');

    const search = await app.inject({
      method: 'POST',
      url: `/v1/stores/${maviId}/search`,
      payload: {
        query: 'Mavi Ürün',
        discoverySessionId: session.id,
        limit: 1,
      },
    });
    const searchBody = search.json<{
      searchId: string;
      products: Array<{ productId: string }>;
    }>();
    const detail = await app.inject({
      method: 'GET',
      url: `/v1/products/${searchBody.products[0]?.productId}/detail?searchId=${searchBody.searchId}&discoverySessionId=${session.id}`,
    });
    const detailBody = detail.json<{
      discoverySessionId: string;
      similarProducts: Array<{ productId: string }>;
    }>();
    expect(detailBody.discoverySessionId).toBe(session.id);
    expect(detailBody.similarProducts.length).toBeGreaterThan(0);

    const similarDetail = await app.inject({
      method: 'GET',
      url: `/v1/products/${detailBody.similarProducts[0]?.productId}/detail?searchId=${searchBody.searchId}&discoverySessionId=${session.id}`,
    });
    const similarBody = similarDetail.json<{
      discoverySessionId: string;
      offers: Array<{ checkoutUrl: string | null }>;
    }>();
    expect(similarBody.discoverySessionId).toBe(session.id);
    const redirect = await app.inject({
      method: 'GET',
      url: new URL(similarBody.offers[0]?.checkoutUrl ?? '').pathname,
      headers: { 'user-agent': 'Mozilla/5.0 attribution chain' },
    });
    expect(redirect.statusCode).toBe(302);

    const [click] = await database.db
      .select({
        discoverySessionId: redirectClicks.discoverySessionId,
        campaign: redirectClicks.campaign,
      })
      .from(redirectClicks)
      .where(eq(redirectClicks.searchId, searchBody.searchId));
    expect(click).toEqual({
      discoverySessionId: session.id,
      campaign: 'summer-2026',
    });

    const invalidCampaign = await app.inject({
      method: 'POST',
      url: '/discovery-session',
      payload: { merchant: 'mavi', surface: 'web', campaign: 'bad campaign!' },
    });
    expect(invalidCampaign.statusCode).toBe(400);
  });

  afterAll(async () => {
    await app.close();
    await database.close();
  });

  it('persists instagram_bio branded checkout attribution end-to-end', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/discovery-session',
      payload: {
        merchant: 'mavi',
        surface: 'brand_widget',
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
      surface: 'brand_widget',
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
      products: Array<{
        checkoutUrl: string;
        productId: string;
        offerId: string;
        merchantId: string;
      }>;
    }>();
    expect(searchBody.products).toHaveLength(1);
    const product = searchBody.products[0];
    expect(product).toBeDefined();

    const [searchEvent] = await database.db
      .select({
        searchId: searchEvents.searchId,
        discoverySessionId: searchEvents.discoverySessionId,
        surface: searchEvents.surface,
      })
      .from(searchEvents)
      .where(eq(searchEvents.searchId, searchBody.searchId));
    expect(searchEvent).toEqual({
      searchId: searchBody.searchId,
      discoverySessionId: session.id,
      surface: 'brand_widget',
    });

    const redirectPath = new URL(product?.checkoutUrl ?? '').pathname;
    const token = redirectPath.slice('/r/'.length);
    const payloadPart = token.split('.')[0] ?? '';
    const tokenPayload = JSON.parse(
      Buffer.from(payloadPart, 'base64url').toString('utf8'),
    );
    expect(tokenPayload).toMatchObject({
      searchId: searchBody.searchId,
      transport: 'rest',
      surface: 'brand_widget',
    });
    expect(tokenPayload).not.toHaveProperty('discoverySessionId');
    expect(tokenPayload).not.toHaveProperty('campaign');
    expect(tokenPayload).not.toHaveProperty('productId');
    expect(JSON.stringify(tokenPayload)).not.toContain(session.id);

    const redirect = await app.inject({
      method: 'GET',
      url: redirectPath,
      headers: { 'user-agent': 'Mozilla/5.0 ShopAI discovery test' },
    });
    expect(redirect.statusCode).toBe(302);
    const merchantLocation = new URL(redirect.headers.location ?? '');
    expect(merchantLocation.origin).toBe('https://merchant.example');
    expect(merchantLocation.pathname).toBe('/mavi-product');
    expect(merchantLocation.searchParams.get('shopai_click_id')).toMatch(
      /^[0-9a-f-]{36}$/u,
    );

    const [click] = await database.db
      .select({
        searchId: redirectClicks.searchId,
        discoverySessionId: redirectClicks.discoverySessionId,
        merchantId: redirectClicks.merchantId,
        productId: redirectClicks.productId,
        offerId: redirectClicks.offerId,
        surface: redirectClicks.surface,
        campaign: redirectClicks.campaign,
        classification: redirectClicks.classification,
        occurredAt: redirectClicks.occurredAt,
      })
      .from(redirectClicks)
      .where(eq(redirectClicks.searchId, searchBody.searchId));
    expect(click).toMatchObject({
      searchId: searchBody.searchId,
      discoverySessionId: session.id,
      merchantId: maviId,
      productId: product?.productId,
      offerId: product?.offerId,
      surface: 'brand_widget',
      campaign: 'instagram_bio',
      classification: 'human',
    });
    expect(click?.occurredAt).toBeInstanceOf(Date);

    const outsideScope = await app.inject({
      method: 'POST',
      url: `/v1/stores/${otherId}/search`,
      payload: { query: 'anything', discoverySessionId: session.id },
    });
    expect(outsideScope.statusCode).toBe(403);
  });

  it('persists a real MCP checkout click with surface chatgpt', async () => {
    const search = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { accept: 'application/json, text/event-stream' },
      payload: {
        jsonrpc: '2.0',
        id: 12,
        method: 'tools/call',
        params: {
          name: 'search_products',
          arguments: { limit: 1 },
        },
      },
    });
    expect(search.statusCode).toBe(200);
    const result = search.json().result.structuredContent as {
      searchId: string;
      products: Array<{
        checkoutUrl: string;
        merchantId: string;
        productId: string;
        offerId: string;
      }>;
    };
    expect(result.products).toHaveLength(1);
    const product = result.products[0];
    expect(product).toBeDefined();

    const redirectPath = new URL(product?.checkoutUrl ?? '').pathname;
    const redirect = await app.inject({
      method: 'GET',
      url: redirectPath,
      headers: { 'user-agent': 'Mozilla/5.0 ChatGPT external navigation' },
    });
    expect(redirect.statusCode).toBe(302);

    const [click] = await database.db
      .select({
        discoverySessionId: redirectClicks.discoverySessionId,
        searchId: redirectClicks.searchId,
        merchantId: redirectClicks.merchantId,
        productId: redirectClicks.productId,
        offerId: redirectClicks.offerId,
        surface: redirectClicks.surface,
        transport: redirectClicks.transport,
        campaign: redirectClicks.campaign,
        classification: redirectClicks.classification,
      })
      .from(redirectClicks)
      .where(eq(redirectClicks.searchId, result.searchId));
    expect(click).toMatchObject({
      searchId: result.searchId,
      merchantId: product?.merchantId,
      productId: product?.productId,
      offerId: product?.offerId,
      surface: 'chatgpt',
      transport: 'mcp',
      campaign: null,
      classification: 'human',
    });
    expect(click?.discoverySessionId).toMatch(/^[0-9a-f-]{36}$/u);

    const [session] = await database.db
      .select({
        surface: discoverySessions.surface,
        transport: discoverySessions.transport,
      })
      .from(discoverySessions)
      .where(eq(discoverySessions.id, click?.discoverySessionId ?? ''));
    expect(session).toEqual({ surface: 'chatgpt', transport: 'mcp' });
  });

  it('stores bot previews separately and never counts them as human clicks', async () => {
    const search = await app.inject({
      method: 'POST',
      url: `/v1/stores/${maviId}/search`,
      payload: { limit: 1 },
    });
    const body = search.json<{
      searchId: string;
      products: Array<{ checkoutUrl: string }>;
    }>();
    const redirectPath = new URL(body.products[0]?.checkoutUrl ?? '').pathname;

    const preview = await app.inject({
      method: 'GET',
      url: redirectPath,
      headers: {
        'user-agent': 'Mozilla/5.0',
        purpose: 'preview',
      },
    });
    expect(preview.statusCode).toBe(302);

    const [counts] = await database.db
      .select({
        human: sql<number>`count(*) filter (where ${redirectClicks.classification} = 'human')::int`,
        bot: sql<number>`count(*) filter (where ${redirectClicks.classification} = 'bot')::int`,
      })
      .from(redirectClicks)
      .where(eq(redirectClicks.searchId, body.searchId));
    expect(counts).toEqual({ human: 0, bot: 1 });
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

  it('rejects an already signed redirect after the merchant becomes private', async () => {
    const search = await app.inject({
      method: 'POST',
      url: `/v1/stores/${maviId}/search`,
      payload: { query: 'Mavi Ürün', limit: 1 },
    });
    expect(search.statusCode).toBe(200);
    const body = search.json<{
      searchId: string;
      products: Array<{ checkoutUrl: string }>;
    }>();
    expect(body.products).toHaveLength(1);
    const redirectPath = new URL(body.products[0]?.checkoutUrl ?? '').pathname;

    await database.db
      .update(merchants)
      .set({ isPublic: false })
      .where(eq(merchants.id, maviId));

    const redirect = await app.inject({
      method: 'GET',
      url: redirectPath,
      headers: { 'user-agent': 'Mozilla/5.0 stale signed redirect test' },
    });
    expect(redirect.statusCode).toBe(404);
    expect(redirect.json()).toEqual({
      code: 'OFFER_UNAVAILABLE',
      message: 'Ürün bağlantısı artık kullanılamıyor.',
    });

    const clicks = await database.db
      .select({ id: redirectClicks.id })
      .from(redirectClicks)
      .where(eq(redirectClicks.searchId, body.searchId));
    expect(clicks).toEqual([]);
  });
});
