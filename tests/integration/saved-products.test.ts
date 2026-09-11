import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../apps/api/src/app.js';
import { parseApiEnv } from '../../apps/api/src/env.js';
import { createServices } from '../../apps/api/src/services.js';
import { createDatabase } from '../../packages/db/src/client.js';
import { importCatalog } from '../../packages/db/src/import-catalog.js';
import {
  anonymousShoppingProfiles,
  connections,
  discoverySessions,
  merchants,
  products,
  savedProducts,
  users,
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

describeWithDatabase('saved products', () => {
  if (!databaseUrl) return;

  const env = parseApiEnv({
    CATALOG_MODE: 'postgres',
    DATABASE_URL: databaseUrl,
    MCP_PUBLIC_ORIGIN: 'https://api.test.example',
    WIDGET_ORIGIN: 'https://widget.test.example',
    REDIRECT_SIGNING_SECRET: 'saved-products-redirect-secret-000000000000',
    CONVERSION_CALLBACK_SECRET: 'saved-products-conversion-secret-0000000000',
    AUTH_PILOT_CREDENTIALS: JSON.stringify({
      'saved-user@test.example': 'saved-products-user-token',
    }),
    UPLOAD_DIR: '/tmp/shopai-saved-products-uploads',
  });
  const database = createDatabase(databaseUrl);
  const services = createServices(env);
  const merchantId = 'fa000000-0000-4000-8000-000000000001';
  const connectionId = 'fa000000-0000-4000-8000-000000000002';

  let app: Awaited<ReturnType<typeof buildApp>>;
  let anonymousCookie = '';
  let anonymousUserId = '';
  let productId = '';
  let variantId = '';
  let savedId = '';

  beforeAll(async () => {
    await database.db.execute(
      sql`truncate table ${savedProducts}, ${anonymousShoppingProfiles}, ${discoverySessions}, ${connections}, ${users}, ${merchants} cascade`,
    );
    await database.db.insert(merchants).values({
      id: merchantId,
      name: 'Saved Products Merchant',
      slug: `saved-products-${randomUUID()}`,
      active: true,
      isPublic: true,
    });
    await database.db.insert(connections).values({
      id: connectionId,
      merchantId,
      provider: 'csv',
      authorizationStatus: 'active',
    });
    await importCatalog(database.db, {
      schemaVersion: 1,
      runId: randomUUID(),
      merchantId,
      connectionId,
      observedAt: new Date().toISOString(),
      rows: [
        {
          externalId: 'saved-products-offer',
          productKey: 'saved-products-product',
          title: 'Kaydedilebilir Tişört',
          description: 'Saved products integration fixture',
          category: 'tshirt',
          size: 'M',
          color: 'black',
          priceMinor: 12_500,
          currency: 'TRY',
          available: true,
          checkoutUrl: 'https://merchant.example/saved-products',
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
      throw new Error('Saved products katalog fixture oluşturulamadı.');
    await database.db
      .update(products)
      .set({ published: true })
      .where(eq(products.id, productId));
    app = await buildApp(services, env);
  });

  afterAll(async () => {
    await app.close();
    await database.close();
  });

  it('connects Web and ChatGPT saves to the same anonymous shopping profile', async () => {
    const profile = await app.inject({
      method: 'GET',
      url: '/v1/shopping-profile',
    });
    expect(profile.statusCode).toBe(200);
    anonymousCookie = cookieFrom(profile);
    anonymousUserId = profile.json().anonymousUserId;

    const webSave = await app.inject({
      method: 'POST',
      url: '/v1/saved-products',
      headers: { cookie: anonymousCookie },
      payload: { productId, variantId },
    });
    expect(webSave.statusCode).toBe(201);
    savedId = webSave.json().item.id;
    expect(webSave.json().item).toMatchObject({
      productId,
      variantId,
      available: true,
    });

    const chatgptSave = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        accept: 'application/json, text/event-stream',
        cookie: anonymousCookie,
      },
      payload: mcpPayload('save_product', { productId, variantId }),
    });
    expect(chatgptSave.statusCode).toBe(200);
    expect(chatgptSave.json().result.structuredContent.item.id).toBe(savedId);

    const chatgptList = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        accept: 'application/json, text/event-stream',
        cookie: anonymousCookie,
      },
      payload: mcpPayload('list_saved_products'),
    });
    expect(chatgptList.statusCode).toBe(200);
    expect(chatgptList.json().result.structuredContent.items).toHaveLength(1);
    expect(chatgptList.json().result.structuredContent.items[0].id).toBe(
      savedId,
    );

    const [row] = await database.db
      .select({
        id: savedProducts.id,
        anonymousUserId: savedProducts.anonymousUserId,
        userId: savedProducts.userId,
      })
      .from(savedProducts)
      .where(eq(savedProducts.id, savedId));
    expect(row).toEqual({
      id: savedId,
      anonymousUserId,
      userId: null,
    });
  });

  it('keeps saved history when the product later becomes unavailable', async () => {
    await database.db
      .update(products)
      .set({ published: false })
      .where(eq(products.id, productId));

    const saved = await app.inject({
      method: 'GET',
      url: '/v1/saved-products',
      headers: { cookie: anonymousCookie },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().items).toEqual([
      expect.objectContaining({
        id: savedId,
        productId,
        variantId,
        available: false,
        product: null,
      }),
    ]);

    const [row] = await database.db
      .select({ id: savedProducts.id })
      .from(savedProducts)
      .where(eq(savedProducts.id, savedId));
    expect(row?.id).toBe(savedId);

    await database.db
      .update(products)
      .set({ published: true })
      .where(eq(products.id, productId));
  });

  it('isolates saved products between anonymous identities', async () => {
    const second = await app.inject({
      method: 'GET',
      url: '/v1/saved-products',
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().items).toEqual([]);
    const secondCookie = cookieFrom(second);
    const secondId = secondCookie.split('=')[1];
    expect(secondId).toBeTruthy();
    expect(secondId).not.toBe(anonymousUserId);

    const secondScopedRows = await database.db.transaction(async (tx) => {
      await tx.execute(sql`set local role shopai_public`);
      await tx.execute(
        sql`select set_config('app.anonymous_user_id', ${secondId}, true)`,
      );
      return tx.select({ id: savedProducts.id }).from(savedProducts);
    });
    expect(secondScopedRows).toEqual([]);
  });

  it('stores authenticated saves under user_id instead of anonymous identity', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: {
        email: 'saved-user@test.example',
        token: 'saved-products-user-token',
      },
    });
    expect(login.statusCode).toBe(200);
    const sessionCookie = cookieFrom(login);

    const save = await app.inject({
      method: 'POST',
      url: '/v1/saved-products',
      headers: { cookie: sessionCookie },
      payload: { productId },
    });
    expect(save.statusCode).toBe(201);
    const userSavedId = save.json().item.id;

    const [user] = await database.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, 'saved-user@test.example'));
    const [row] = await database.db
      .select({
        userId: savedProducts.userId,
        anonymousUserId: savedProducts.anonymousUserId,
      })
      .from(savedProducts)
      .where(eq(savedProducts.id, userSavedId));
    expect(row).toEqual({ userId: user?.id, anonymousUserId: null });
  });

  it('does not grant merchant application role access to shopper saves', async () => {
    await expect(
      database.db.transaction(async (tx) => {
        await tx.execute(sql`set local role shopai_app`);
        return tx.select({ id: savedProducts.id }).from(savedProducts);
      }),
    ).rejects.toThrow();
  });
});
