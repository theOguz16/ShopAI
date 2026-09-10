import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../apps/api/src/app.js';
import { parseApiEnv } from '../../apps/api/src/env.js';
import {
  connections,
  createDatabase,
  inventory,
  memberships,
  merchants,
  offers,
  products,
  sessions,
  users,
  variants,
  withTenant,
} from '../../packages/db/src/index.js';

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;

if (!databaseUrl || !redisUrl) {
  describe.skip('catalog health integration', () => {
    it('requires PostgreSQL and Redis', () => undefined);
  });
} else {
  const email = 'catalog-health@test.example';
  const loginToken = 'catalog-health-test-token-000000';
  const env = parseApiEnv({
    CATALOG_MODE: 'postgres',
    DATABASE_URL: databaseUrl,
    REDIS_URL: redisUrl,
    MCP_PUBLIC_ORIGIN: 'https://api.catalog-health.test',
    WIDGET_ORIGIN: 'https://widget.catalog-health.test',
    REDIRECT_SIGNING_SECRET: 'catalog-health-redirect-secret-000000000000',
    AUTH_PILOT_CREDENTIALS: JSON.stringify({ [email]: loginToken }),
    LOGIN_RATE_LIMIT_MAX: '30',
    LOG_LEVEL: 'silent',
  });
  const database = createDatabase(databaseUrl, {
    applicationName: 'shopai-catalog-health-fixtures',
  });
  let app: Awaited<ReturnType<typeof buildApp>>;
  let cookie = '';
  let merchantId = '';

  describe.sequential('catalog health integration', () => {
    beforeAll(async () => {
      await database.db.execute(
        sql`truncate table ${inventory}, ${offers}, ${variants}, ${products}, ${connections}, ${memberships}, ${sessions}, ${users}, ${merchants} cascade`,
      );
      app = await buildApp(undefined, env);
      const login = await app.inject({
        method: 'POST',
        url: '/v1/auth/login',
        payload: { email, token: loginToken },
      });
      expect(login.statusCode).toBe(200);
      cookie = login.headers['set-cookie']?.split(';')[0] ?? '';
      const setup = await app.inject({
        method: 'POST',
        url: '/v1/setup/merchant',
        headers: { cookie },
        payload: { name: 'Catalog Health Store' },
      });
      expect(setup.statusCode).toBe(201);
      merchantId = setup.json<{ merchant: { id: string } }>().merchant.id;

      const connectionId = randomUUID();
      const productIds = Array.from({ length: 4 }, () => randomUUID());
      const variantIds = Array.from({ length: 3 }, () => randomUUID());
      const offerIds = Array.from({ length: 3 }, () => randomUUID());
      const observedAt = new Date();
      const staleSuccessfulSync = new Date(Date.now() - 14 * 60 * 60 * 1000);

      await withTenant(database.db, merchantId, async (tx) => {
        await tx.insert(connections).values({
          id: connectionId,
          merchantId,
          provider: 'woocommerce',
          active: true,
          authorizationStatus: 'active',
          syncMode: 'incremental',
          lastSuccessfulSyncAt: staleSuccessfulSync,
          lastFetchedAt: staleSuccessfulSync,
        });
        await tx.insert(products).values([
          {
            id: productIds[0],
            merchantId,
            connectionId,
            externalKey: 'health-product-1',
            title: 'Published in-stock product',
            category: 'test',
            published: true,
            imageUrl: 'https://cdn.example/1.jpg',
            observedAt,
          },
          {
            id: productIds[1],
            merchantId,
            connectionId,
            externalKey: 'health-product-2',
            title: 'Published out-of-stock product',
            category: 'test',
            published: true,
            imageUrl: null,
            observedAt,
          },
          {
            id: productIds[2],
            merchantId,
            connectionId,
            externalKey: 'health-product-3',
            title: 'Draft priced product',
            category: 'test',
            published: false,
            imageUrl: 'https://cdn.example/3.jpg',
            observedAt,
          },
          {
            id: productIds[3],
            merchantId,
            connectionId,
            externalKey: 'health-product-4',
            title: 'Published product without active price',
            category: 'test',
            published: true,
            imageUrl: '   ',
            observedAt,
          },
        ]);
        await tx.insert(variants).values(
          variantIds.map((id, index) => ({
            id,
            merchantId,
            productId: productIds[index] ?? productIds[0],
            connectionId,
            externalId: `health-variant-${index + 1}`,
            size: 'M',
            color: 'black',
            observedAt,
          })),
        );
        await tx.insert(offers).values(
          offerIds.map((id, index) => ({
            id,
            merchantId,
            variantId: variantIds[index] ?? variantIds[0],
            connectionId,
            externalId: `health-offer-${index + 1}`,
            priceMinor: 10_000 + index,
            currency: 'TRY',
            checkoutUrl: `https://shop.example/product-${index + 1}`,
            active: true,
            observedAt,
          })),
        );
        await tx.insert(inventory).values([
          {
            offerId: offerIds[0] ?? '',
            merchantId,
            available: true,
            observedAt,
          },
          {
            offerId: offerIds[1] ?? '',
            merchantId,
            available: false,
            observedAt,
          },
          {
            offerId: offerIds[2] ?? '',
            merchantId,
            available: true,
            observedAt,
          },
        ]);
      });
    });

    afterAll(async () => {
      await app?.close();
      await database.close();
    });

    it('calculates catalog health from persisted tenant records', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/v1/merchants/${merchantId}/catalog-health`,
        headers: { cookie },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        merchantId,
        totalProducts: 4,
        publishedProducts: 3,
        activeProducts: 2,
        inStockProducts: 1,
        missingImages: 2,
        missingPrices: 1,
        connections: [
          {
            provider: 'woocommerce',
            status: 'stale',
            authorizationStatus: 'active',
          },
        ],
      });
      const body = response.json<{
        lastSuccessfulSyncAgeMs: number;
        connections: Array<{ lastSuccessfulSyncAgeMs: number }>;
      }>();
      expect(body.lastSuccessfulSyncAgeMs).toBeGreaterThanOrEqual(
        13 * 60 * 60 * 1000,
      );
      expect(body.connections[0]?.lastSuccessfulSyncAgeMs).toBeGreaterThanOrEqual(
        13 * 60 * 60 * 1000,
      );
    });

    it('requires merchant membership', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/v1/merchants/${randomUUID()}/catalog-health`,
        headers: { cookie },
      });
      expect(response.statusCode).toBe(403);
    });
  });
}
