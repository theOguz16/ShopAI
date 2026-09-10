import {
  catalogConnectionHealth,
  type CatalogConnectionHealth,
} from '@shopai/commerce/catalog-health';
import {
  connections,
  inventory,
  offers,
  products,
  setTenantContext,
  variants,
} from '@shopai/db';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { requireRole } from '../plugins/auth.js';

type Params = { merchantId: string };

type ConnectionHealthView = {
  id: string;
  provider: string;
  status: CatalogConnectionHealth;
  authorizationStatus: string;
  lastSuccessfulSyncAt: string | null;
  lastSuccessfulSyncAgeMs: number | null;
  lastSyncError: string | null;
};

export async function registerCatalogHealthRoutes(app: FastifyInstance) {
  app.get(
    '/v1/merchants/:merchantId/catalog-health',
    { preHandler: requireRole('owner', 'editor', 'viewer') },
    async (request, reply) => {
      const { merchantId } = request.params as Params;
      const db = app.authApi.db;
      if (!db) return reply.code(503).send({ code: 'AUTH_UNAVAILABLE' });

      const now = new Date();
      return db.transaction(async (tx) => {
        await setTenantContext(tx, merchantId);
        const [counts] = await tx
          .select({
            totalProducts: sql<number>`count(distinct ${products.id})::integer`,
            publishedProducts: sql<number>`(count(distinct ${products.id}) filter (where ${products.published} = true))::integer`,
            pricedProducts: sql<number>`(count(distinct ${products.id}) filter (where ${offers.active} = true))::integer`,
            activeProducts: sql<number>`(count(distinct ${products.id}) filter (where ${products.published} = true and ${offers.active} = true))::integer`,
            inStockProducts: sql<number>`(count(distinct ${products.id}) filter (where ${products.published} = true and ${offers.active} = true and ${inventory.available} = true))::integer`,
            missingImages: sql<number>`(count(distinct ${products.id}) filter (where coalesce(nullif(btrim(${products.imageUrl}), ''), '') = ''))::integer`,
          })
          .from(products)
          .leftJoin(
            variants,
            and(
              eq(variants.productId, products.id),
              eq(variants.merchantId, merchantId),
            ),
          )
          .leftJoin(
            offers,
            and(
              eq(offers.variantId, variants.id),
              eq(offers.merchantId, merchantId),
            ),
          )
          .leftJoin(
            inventory,
            and(
              eq(inventory.offerId, offers.id),
              eq(inventory.merchantId, merchantId),
            ),
          )
          .where(eq(products.merchantId, merchantId));

        const connectionRows = await tx
          .select({
            id: connections.id,
            provider: connections.provider,
            active: connections.active,
            authorizationStatus: connections.authorizationStatus,
            lastSuccessfulSyncAt: connections.lastSuccessfulSyncAt,
            lastSyncError: connections.lastSyncError,
          })
          .from(connections)
          .where(eq(connections.merchantId, merchantId))
          .orderBy(desc(connections.active), desc(connections.lastSuccessfulSyncAt));

        const connectionHealth: ConnectionHealthView[] = connectionRows.map(
          (connection) => {
            const lastSuccessfulSyncAt = connection.lastSuccessfulSyncAt;
            return {
              id: connection.id,
              provider: connection.provider,
              status: catalogConnectionHealth(connection, now.getTime()),
              authorizationStatus: connection.authorizationStatus,
              lastSuccessfulSyncAt:
                lastSuccessfulSyncAt?.toISOString() ?? null,
              lastSuccessfulSyncAgeMs: lastSuccessfulSyncAt
                ? Math.max(0, now.getTime() - lastSuccessfulSyncAt.getTime())
                : null,
              lastSyncError: connection.lastSyncError,
            };
          },
        );
        const latestSuccessfulSync = connectionRows.reduce<Date | null>(
          (latest, connection) => {
            const candidate = connection.lastSuccessfulSyncAt;
            if (!candidate || (latest && candidate <= latest)) return latest;
            return candidate;
          },
          null,
        );
        const totalProducts = counts?.totalProducts ?? 0;
        const pricedProducts = counts?.pricedProducts ?? 0;

        return {
          merchantId,
          generatedAt: now.toISOString(),
          totalProducts,
          publishedProducts: counts?.publishedProducts ?? 0,
          activeProducts: counts?.activeProducts ?? 0,
          inStockProducts: counts?.inStockProducts ?? 0,
          missingImages: counts?.missingImages ?? 0,
          missingPrices: Math.max(0, totalProducts - pricedProducts),
          lastSuccessfulSyncAt: latestSuccessfulSync?.toISOString() ?? null,
          lastSuccessfulSyncAgeMs: latestSuccessfulSync
            ? Math.max(0, now.getTime() - latestSuccessfulSync.getTime())
            : null,
          connections: connectionHealth,
        };
      });
    },
  );
}
