import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../apps/api/src/app.js';
import { parseApiEnv } from '../../apps/api/src/env.js';
import { sourceCategoryMappings } from '../../packages/db/src/category-model.js';
import { importCatalog } from '../../packages/db/src/import-catalog.js';
import {
  connections,
  createDatabase,
  memberships,
  merchants,
  products,
  sessions,
  users,
  withTenant,
} from '../../packages/db/src/index.js';

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;

if (!databaseUrl || !redisUrl) {
  describe.skip('category mapping integration', () => {
    it('requires PostgreSQL and Redis', () => undefined);
  });
} else {
  const credentials = {
    'category-owner-a@test.example': 'category-owner-a-token-000000',
    'category-owner-b@test.example': 'category-owner-b-token-000000',
    'category-editor@test.example': 'category-editor-token-00000000',
    'category-viewer@test.example': 'category-viewer-token-00000000',
  };
  const env = parseApiEnv({
    CATALOG_MODE: 'postgres',
    DATABASE_URL: databaseUrl,
    REDIS_URL: redisUrl,
    MCP_PUBLIC_ORIGIN: 'https://api.category-mapping.test',
    WIDGET_ORIGIN: 'https://widget.category-mapping.test',
    REDIRECT_SIGNING_SECRET: 'category-mapping-redirect-secret-000000000000',
    AUTH_PILOT_CREDENTIALS: JSON.stringify(credentials),
    LOGIN_RATE_LIMIT_MAX: '30',
    LOG_LEVEL: 'silent',
  });
  const database = createDatabase(databaseUrl, {
    applicationName: 'shopai-category-mapping-fixtures',
  });

  let app: Awaited<ReturnType<typeof buildApp>>;
  let ownerACookie = '';
  let ownerBCookie = '';
  let editorCookie = '';
  let viewerCookie = '';
  let merchantA = '';
  let merchantB = '';
  let connectionA = '';
  let connectionB = '';
  let shirtMappingA = '';
  let shirtMappingB = '';
  let fishingMappingA = '';
  let sportsMappingA = '';
  let unmappedMappingA = '';

  async function login(email: keyof typeof credentials) {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email, token: credentials[email] },
    });
    expect(response.statusCode).toBe(200);
    return {
      cookie: response.headers['set-cookie']?.split(';')[0] ?? '',
      userId: response.json<{ user: { id: string } }>().user.id,
    };
  }

  async function setupMerchant(cookie: string, name: string) {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/setup/merchant',
      headers: { cookie },
      payload: { name },
    });
    expect(response.statusCode).toBe(201);
    return response.json<{ merchant: { id: string } }>().merchant.id;
  }

  async function listMappings(
    cookie: string,
    merchantId: string,
    status: 'all' | 'mapped' | 'unmapped' = 'all',
  ) {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/merchants/${merchantId}/category-mappings?status=${status}`,
      headers: { cookie },
    });
    return response;
  }

  async function updateMapping(
    cookie: string,
    merchantId: string,
    mappingId: string,
    canonicalCategoryKey: string | null,
  ) {
    return app.inject({
      method: 'PUT',
      url: `/v1/merchants/${merchantId}/category-mappings/${mappingId}`,
      headers: { cookie },
      payload: { canonicalCategoryKey },
    });
  }

  describe.sequential('category mapping integration', () => {
    beforeAll(async () => {
      await database.db.execute(
        sql`truncate table ${sourceCategoryMappings}, ${products}, ${connections}, ${memberships}, ${sessions}, ${users}, ${merchants} cascade`,
      );
      app = await buildApp(undefined, env);

      const ownerA = await login('category-owner-a@test.example');
      const ownerB = await login('category-owner-b@test.example');
      const editor = await login('category-editor@test.example');
      const viewer = await login('category-viewer@test.example');
      ownerACookie = ownerA.cookie;
      ownerBCookie = ownerB.cookie;
      editorCookie = editor.cookie;
      viewerCookie = viewer.cookie;

      merchantA = await setupMerchant(ownerACookie, 'Category Merchant A');
      merchantB = await setupMerchant(ownerBCookie, 'Category Merchant B');

      await withTenant(database.db, merchantA, async (tx) => {
        await tx.insert(memberships).values([
          { merchantId: merchantA, userId: editor.userId, role: 'editor' },
          { merchantId: merchantA, userId: viewer.userId, role: 'viewer' },
        ]);
        const [connection] = await tx
          .insert(connections)
          .values({
            merchantId: merchantA,
            provider: 'woocommerce',
            authorizationStatus: 'active',
          })
          .returning({ id: connections.id });
        if (!connection) throw new Error('Merchant A connection missing');
        connectionA = connection.id;
      });

      await withTenant(database.db, merchantB, async (tx) => {
        const [connection] = await tx
          .insert(connections)
          .values({
            merchantId: merchantB,
            provider: 'woocommerce',
            authorizationStatus: 'active',
          })
          .returning({ id: connections.id });
        if (!connection) throw new Error('Merchant B connection missing');
        connectionB = connection.id;
      });

      await importCatalog(database.db, {
        schemaVersion: 1,
        runId: randomUUID(),
        merchantId: merchantA,
        connectionId: connectionA,
        observedAt: new Date().toISOString(),
        rows: [
          {
            externalId: 'a-shirt-m-black',
            productKey: 'a-shirt',
            title: 'A Tişört Ürün',
            description: 'Mapped apparel fixture ürün',
            category: 'Tişört',
            sourceCategoryId: 'shared-shirt',
            sourceCategoryPath: ['Giyim', 'Üst Giyim', 'Tişört'],
            productAttributes: [
              { key: 'material', label: 'Malzeme', value: 'cotton' },
            ],
            variantOptions: [
              { key: 'size', label: 'Beden', value: 'M' },
              { key: 'color', label: 'Renk', value: 'black' },
            ],
            priceMinor: 10_000,
            currency: 'TRY',
            available: true,
            checkoutUrl: 'https://merchant-a.example/shirt',
          },
          {
            externalId: 'a-shirt-xl-red',
            productKey: 'a-unmapped-shirt',
            title: 'A Eşlenmemiş Ürün',
            description: 'Unmapped fixture ürün',
            category: 'Tişört',
            sourceCategoryId: 'unmapped-shirt',
            sourceCategoryPath: ['Giyim', 'Belirsiz', 'Tişört'],
            variantOptions: [
              { key: 'size', label: 'Beden', value: 'XL' },
              { key: 'color', label: 'Renk', value: 'red' },
            ],
            priceMinor: 11_000,
            currency: 'TRY',
            available: true,
            checkoutUrl: 'https://merchant-a.example/unmapped',
          },
          {
            externalId: 'a-rod-240',
            productKey: 'a-rod',
            title: 'A Karbon Olta Ürün',
            description: 'Fishing fixture ürün',
            category: 'Olta',
            sourceCategoryId: 'fishing-rods',
            sourceCategoryPath: ['Balıkçılık', 'Oltalar'],
            variantOptions: [
              {
                key: 'length',
                label: 'Uzunluk',
                value: '240',
                unit: 'cm',
                rawValue: '240 cm',
              },
              { key: 'power', label: 'Güç', value: 'medium' },
            ],
            priceMinor: 32_000,
            currency: 'TRY',
            available: true,
            checkoutUrl: 'https://merchant-a.example/rod',
          },
          {
            externalId: 'a-bottle-750',
            productKey: 'a-bottle',
            title: 'A Spor Şişesi Ürün',
            description: 'Sports fixture ürün',
            category: 'Spor',
            sourceCategoryId: 'sports-bottles',
            sourceCategoryPath: ['Spor', 'Suluk'],
            variantOptions: [
              {
                key: 'capacity',
                label: 'Kapasite',
                value: '750',
                unit: 'ml',
                rawValue: '750 ml',
              },
              { key: 'number', label: 'Numara', value: '5' },
            ],
            priceMinor: 8_900,
            currency: 'TRY',
            available: true,
            checkoutUrl: 'https://merchant-a.example/bottle',
          },
        ],
      });

      await importCatalog(database.db, {
        schemaVersion: 1,
        runId: randomUUID(),
        merchantId: merchantB,
        connectionId: connectionB,
        observedAt: new Date(Date.now() + 1).toISOString(),
        rows: [
          {
            externalId: 'b-shirt-l-white',
            productKey: 'b-shirt',
            title: 'B T-shirt Ürün',
            description: 'Mapped apparel fixture ürün',
            category: 'T-shirt',
            sourceCategoryId: 'shared-shirt',
            sourceCategoryPath: ['Apparel', 'T-shirts'],
            productAttributes: [
              { key: 'material', label: 'Material', value: 'polyester' },
            ],
            variantOptions: [
              { key: 'size', label: 'Size', value: 'L' },
              { key: 'color', label: 'Color', value: 'white' },
            ],
            priceMinor: 12_000,
            currency: 'TRY',
            available: true,
            checkoutUrl: 'https://merchant-b.example/shirt',
          },
        ],
      });

      await withTenant(database.db, merchantA, async (tx) => {
        await tx
          .update(merchants)
          .set({ isPublic: true })
          .where(eq(merchants.id, merchantA));
        await tx
          .update(products)
          .set({ published: true })
          .where(eq(products.merchantId, merchantA));
      });
      await withTenant(database.db, merchantB, async (tx) => {
        await tx
          .update(merchants)
          .set({ isPublic: true })
          .where(eq(merchants.id, merchantB));
        await tx
          .update(products)
          .set({ published: true })
          .where(eq(products.merchantId, merchantB));
      });

      const a = await listMappings(ownerACookie, merchantA);
      expect(a.statusCode).toBe(200);
      const aMappings = a.json<{
        mappings: Array<{
          id: string;
          sourceCategoryId: string;
          sourceCategoryName: string;
          sourceCategoryPath: string[] | null;
          status: string;
        }>;
      }>().mappings;
      shirtMappingA =
        aMappings.find((item) => item.sourceCategoryId === 'shared-shirt')
          ?.id ?? '';
      fishingMappingA =
        aMappings.find((item) => item.sourceCategoryId === 'fishing-rods')
          ?.id ?? '';
      sportsMappingA =
        aMappings.find((item) => item.sourceCategoryId === 'sports-bottles')
          ?.id ?? '';
      unmappedMappingA =
        aMappings.find((item) => item.sourceCategoryId === 'unmapped-shirt')
          ?.id ?? '';

      const b = await listMappings(ownerBCookie, merchantB);
      expect(b.statusCode).toBe(200);
      shirtMappingB =
        b
          .json<{ mappings: Array<{ id: string; sourceCategoryId: string }> }>()
          .mappings.find((item) => item.sourceCategoryId === 'shared-shirt')
          ?.id ?? '';

      expect([
        shirtMappingA,
        shirtMappingB,
        fishingMappingA,
        sportsMappingA,
        unmappedMappingA,
      ]).not.toContain('');
    });

    afterAll(async () => {
      await app?.close();
      await database.close();
    });

    it('preserves source category provenance and creates no automatic mapping', async () => {
      const a = await listMappings(ownerACookie, merchantA, 'unmapped');
      expect(a.statusCode).toBe(200);
      const body = a.json<{
        mappings: Array<{
          connectionId: string;
          provider: string;
          sourceCategoryId: string;
          sourceCategoryName: string;
          sourceCategoryPath: string[] | null;
          canonicalCategoryKey: string | null;
          status: string;
        }>;
      }>();
      expect(body.mappings).toHaveLength(4);
      expect(body.mappings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            connectionId: connectionA,
            provider: 'woocommerce',
            sourceCategoryId: 'shared-shirt',
            sourceCategoryName: 'Tişört',
            sourceCategoryPath: ['Giyim', 'Üst Giyim', 'Tişört'],
            canonicalCategoryKey: null,
            status: 'unmapped',
          }),
        ]),
      );

      const b = await listMappings(ownerBCookie, merchantB, 'unmapped');
      expect(b.statusCode).toBe(200);
      expect(b.json().mappings).toEqual([
        expect.objectContaining({
          connectionId: connectionB,
          provider: 'woocommerce',
          sourceCategoryId: 'shared-shirt',
          sourceCategoryName: 'T-shirt',
          sourceCategoryPath: ['Apparel', 'T-shirts'],
          canonicalCategoryKey: null,
          status: 'unmapped',
        }),
      ]);
    });

    it('enforces role writes, tenant isolation and idempotent mapping changes', async () => {
      const viewerRead = await listMappings(viewerCookie, merchantA);
      expect(viewerRead.statusCode).toBe(200);

      const viewerWrite = await updateMapping(
        viewerCookie,
        merchantA,
        shirtMappingA,
        'tshirt',
      );
      expect(viewerWrite.statusCode).toBe(403);

      const editorWrite = await updateMapping(
        editorCookie,
        merchantA,
        fishingMappingA,
        'fishing-rod',
      );
      expect(editorWrite.statusCode).toBe(200);

      expect(
        (await updateMapping(ownerACookie, merchantA, sportsMappingA, 'sports'))
          .statusCode,
      ).toBe(200);
      expect(
        (await updateMapping(ownerBCookie, merchantB, shirtMappingB, 'tshirt'))
          .statusCode,
      ).toBe(200);

      expect(
        (await updateMapping(ownerACookie, merchantA, shirtMappingA, 'sports'))
          .statusCode,
      ).toBe(200);
      const bAfterAChange = await listMappings(ownerBCookie, merchantB);
      expect(
        bAfterAChange
          .json<{
            mappings: Array<{
              sourceCategoryId: string;
              canonicalCategoryKey: string | null;
            }>;
          }>()
          .mappings.find((item) => item.sourceCategoryId === 'shared-shirt')
          ?.canonicalCategoryKey,
      ).toBe('tshirt');

      const first = await updateMapping(
        ownerACookie,
        merchantA,
        shirtMappingA,
        'tshirt',
      );
      expect(first.statusCode).toBe(200);
      const firstBody = first.json<{ updatedAt: string }>();
      const second = await updateMapping(
        ownerACookie,
        merchantA,
        shirtMappingA,
        'tshirt',
      );
      expect(second.statusCode).toBe(200);
      expect(second.json<{ updatedAt: string }>().updatedAt).toBe(
        firstBody.updatedAt,
      );

      const crossTenant = await listMappings(ownerACookie, merchantB);
      expect(crossTenant.statusCode).toBe(403);
      const unmapped = await listMappings(ownerACookie, merchantA, 'unmapped');
      expect(unmapped.statusCode).toBe(200);
      expect(unmapped.json().mappings).toEqual([
        expect.objectContaining({ id: unmappedMappingA }),
      ]);
    });

    it('filters and counts only mapped canonical categories with category-specific generic facets', async () => {
      const apparel = await app.inject({
        method: 'POST',
        url: '/v1/search',
        payload: {
          query: 'ürün',
          category: 'tshirt',
          inStockOnly: false,
          limit: 20,
        },
      });
      expect(apparel.statusCode).toBe(200);
      const apparelBody = apparel.json<{
        products: Array<{
          sourceCategory?: { name: string; path: string[] | null };
          canonicalCategory?: { key: string } | null;
        }>;
        facets: {
          sizes: Array<{ value: string; count: number }>;
          colors: Array<{ value: string; count: number }>;
          attributes?: Record<
            string,
            {
              label: string;
              unit: string | null;
              values: Array<{ value: string; count: number }>;
            }
          >;
        };
      }>();
      expect(apparelBody.products).toHaveLength(2);
      expect(
        apparelBody.products.map((item) => item.sourceCategory?.name),
      ).toEqual(expect.arrayContaining(['Tişört', 'T-shirt']));
      expect(
        apparelBody.products.every(
          (item) => item.canonicalCategory?.key === 'tshirt',
        ),
      ).toBe(true);
      expect(apparelBody.facets.sizes).toEqual(
        expect.arrayContaining([
          { value: 'L', count: 1 },
          { value: 'M', count: 1 },
        ]),
      );
      expect(apparelBody.facets.colors).toEqual(
        expect.arrayContaining([
          { value: 'black', count: 1 },
          { value: 'white', count: 1 },
        ]),
      );
      expect(apparelBody.facets.attributes?.material?.values).toEqual(
        expect.arrayContaining([
          { value: 'cotton', count: 1 },
          { value: 'polyester', count: 1 },
        ]),
      );

      const cotton = await app.inject({
        method: 'POST',
        url: '/v1/search',
        payload: {
          query: 'ürün',
          category: 'tshirt',
          attributes: { material: 'cotton' },
          inStockOnly: false,
          limit: 20,
        },
      });
      expect(cotton.statusCode).toBe(200);
      expect(cotton.json().products).toHaveLength(1);
      expect(cotton.json().products[0].sourceCategory.name).toBe('Tişört');

      const medium = await app.inject({
        method: 'POST',
        url: '/v1/search',
        payload: {
          query: 'ürün',
          category: 'tshirt',
          attributes: { size: 'M' },
          inStockOnly: false,
          limit: 20,
        },
      });
      expect(medium.statusCode).toBe(200);
      expect(medium.json().products).toHaveLength(1);
      expect(medium.json().products[0].sourceCategory.name).toBe('Tişört');

      const fishing = await app.inject({
        method: 'POST',
        url: '/v1/search',
        payload: {
          query: 'ürün',
          category: 'fishing-rod',
          inStockOnly: false,
          limit: 20,
        },
      });
      expect(fishing.statusCode).toBe(200);
      const fishingFacets = fishing.json().facets;
      expect(fishingFacets.sizes).toEqual([]);
      expect(fishingFacets.attributes.length).toMatchObject({
        unit: 'cm',
        values: [{ value: '240', count: 1 }],
      });
      expect(fishingFacets.attributes.power.values).toEqual([
        { value: 'medium', count: 1 },
      ]);

      const sports = await app.inject({
        method: 'POST',
        url: '/v1/search',
        payload: {
          query: 'ürün',
          category: 'sports',
          inStockOnly: false,
          limit: 20,
        },
      });
      expect(sports.statusCode).toBe(200);
      const sportsFacets = sports.json().facets.attributes;
      expect(sportsFacets.capacity).toMatchObject({
        unit: 'ml',
        values: [{ value: '750', count: 1 }],
      });
      expect(sportsFacets.number.values).toEqual([{ value: '5', count: 1 }]);

      const global = await app.inject({
        method: 'POST',
        url: '/v1/search',
        payload: { query: 'ürün', inStockOnly: false, limit: 20 },
      });
      expect(global.statusCode).toBe(200);
      expect(global.json().facets.categories).toEqual(
        expect.arrayContaining([
          { value: 'fishing-rod', count: 1 },
          { value: 'sports', count: 1 },
          { value: 'tshirt', count: 2 },
        ]),
      );
      expect(
        global
          .json()
          .facets.categories.reduce(
            (sum: number, item: { count: number }) => sum + item.count,
            0,
          ),
      ).toBe(4);
      expect(global.json().products).toHaveLength(5);
      expect(
        global
          .json()
          .products.find(
            (item: { title: string }) => item.title === 'A Eşlenmemiş Ürün',
          ),
      ).toMatchObject({ canonicalCategory: null });

      const health = await app.inject({
        method: 'GET',
        url: `/v1/merchants/${merchantA}/catalog-health`,
        headers: { cookie: ownerACookie },
      });
      expect(health.statusCode).toBe(200);
      expect(health.json()).toMatchObject({
        unmappedCategories: 1,
        unmappedProducts: 1,
      });
    });
  });
}
