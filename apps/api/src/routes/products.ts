import {
  bulkPublicationChangeSchema,
  publicationChangeSchema,
} from '@shopai/contracts';
import { stockStatus } from '@shopai/commerce';
import {
  type Database,
  inventory,
  offers,
  products,
  setTenantContext,
  variants,
} from '@shopai/db';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { requireRole, requireSameOrigin } from '../plugins/auth.js';

type Params = { merchantId: string; productId?: string };
type ProductView = {
  id: string;
  merchantId: string;
  connectionId: string;
  externalKey: string;
  title: string;
  description: string;
  category: string;
  published: boolean;
  imageUrl: string | null;
  imageAlt: string | null;
  publicationChangedAt: Date | null;
  publicationChangedBy: string | null;
  observedAt: Date;
};
type VariantView = {
  variant: typeof variants.$inferSelect;
  offer: typeof offers.$inferSelect | null;
  inventory: typeof inventory.$inferSelect | null;
};
type DbExecutor = Parameters<Parameters<Database['transaction']>[0]>[0];

const productFields = {
  id: products.id,
  merchantId: products.merchantId,
  connectionId: products.connectionId,
  externalKey: products.externalKey,
  title: products.title,
  description: products.description,
  category: products.category,
  published: products.published,
  imageUrl: products.imageUrl,
  imageAlt: products.imageAlt,
  publicationChangedAt: products.publicationChangedAt,
  publicationChangedBy: products.publicationChangedBy,
  observedAt: products.observedAt,
};

function serializeProduct(product: ProductView, rows: VariantView[]) {
  return {
    ...product,
    observedAt: product.observedAt.toISOString(),
    publicationChangedAt: product.publicationChangedAt?.toISOString() ?? null,
    variants: rows
      .filter((row) => row.variant.productId === product.id)
      .map((row) => ({
        ...row.variant,
        observedAt: row.variant.observedAt.toISOString(),
        offer: row.offer
          ? {
              ...row.offer,
              priceSource: 'catalog-import',
              observedAt: row.offer.observedAt.toISOString(),
              inventory: row.inventory
                ? {
                    ...row.inventory,
                    stockSource: 'catalog-import',
                    observedAt: row.inventory.observedAt.toISOString(),
                    stockStatus: stockStatus(
                      row.inventory.available,
                      row.inventory.fetchedAt.toISOString(),
                    ),
                  }
                : null,
            }
          : null,
      })),
  };
}

async function loadProducts(db: Database, merchantId: string, ids?: string[]) {
  return db.transaction(async (tx) => {
    await setTenantContext(tx, merchantId);
    const productRows = await tx
      .select(productFields)
      .from(products)
      .where(
        and(
          eq(products.merchantId, merchantId),
          ids?.length ? inArray(products.id, ids) : undefined,
        ),
      )
      .orderBy(asc(products.title), asc(products.id));
    if (!productRows.length) return [];
    const productIds = productRows.map((product) => product.id);
    const variantRows = await tx
      .select({ variant: variants, offer: offers, inventory })
      .from(variants)
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
      .where(
        and(
          eq(variants.merchantId, merchantId),
          inArray(variants.productId, productIds),
        ),
      )
      .orderBy(asc(variants.size), asc(variants.color));
    return productRows.map((product) =>
      serializeProduct(product as ProductView, variantRows),
    );
  });
}

async function canPublish(
  db: DbExecutor,
  merchantId: string,
  productId: string,
) {
  const [product] = await db
    .select(productFields)
    .from(products)
    .where(
      and(eq(products.id, productId), eq(products.merchantId, merchantId)),
    );
  if (!product) return { product: null, reason: 'NOT_FOUND' as const };
  const rows = await db
    .select({ offer: offers })
    .from(variants)
    .innerJoin(
      offers,
      and(
        eq(offers.variantId, variants.id),
        eq(offers.merchantId, merchantId),
        eq(offers.active, true),
      ),
    )
    .where(
      and(
        eq(variants.productId, productId),
        eq(variants.merchantId, merchantId),
      ),
    );
  if (!product.title.trim() || !product.category.trim())
    return { product: null, reason: 'REQUIRED_PRODUCT_FIELDS' as const };
  if (!rows.length)
    return { product: null, reason: 'ACTIVE_OFFER_REQUIRED' as const };
  if (
    rows.some(({ offer }) => new URL(offer.checkoutUrl).protocol !== 'https:')
  )
    return { product: null, reason: 'HTTPS_CHECKOUT_REQUIRED' as const };
  if (product.imageUrl && !product.imageAlt?.trim())
    return { product: null, reason: 'IMAGE_ALT_REQUIRED' as const };
  return { product };
}

export async function registerProductRoutes(app: FastifyInstance) {
  app.get(
    '/v1/merchants/:merchantId/products',
    { preHandler: requireRole('owner', 'editor', 'viewer') },
    async (request, reply) => {
      const { merchantId } = request.params as Params;
      const db = app.authApi.db;
      if (!db) return reply.code(503).send({ code: 'AUTH_UNAVAILABLE' });
      return loadProducts(db, merchantId);
    },
  );
  app.get(
    '/v1/merchants/:merchantId/products/:productId',
    { preHandler: requireRole('owner', 'editor', 'viewer') },
    async (request, reply) => {
      const { merchantId, productId } = request.params as Required<Params>;
      const db = app.authApi.db;
      if (!db) return reply.code(503).send({ code: 'AUTH_UNAVAILABLE' });
      const rows = await loadProducts(db, merchantId, [productId]);
      return rows[0] ?? reply.code(404).send({ code: 'NOT_FOUND' });
    },
  );
  app.post(
    '/v1/merchants/:merchantId/products/:productId/publication',
    { preHandler: [requireSameOrigin, requireRole('owner', 'editor')] },
    async (request, reply) => {
      const { merchantId, productId } = request.params as Required<Params>;
      const parsedBody = publicationChangeSchema.safeParse(request.body);
      if (!parsedBody.success)
        return reply.code(400).send({ code: 'INVALID_INPUT' });
      const body = parsedBody.data;
      const db = app.authApi.db;
      if (!db) return reply.code(503).send({ code: 'AUTH_UNAVAILABLE' });
      const result = await db.transaction(async (tx) => {
        await setTenantContext(tx, merchantId);
        if (body.published) {
          const check = await canPublish(tx, merchantId, productId);
          if (!check.product) return check;
        } else {
          const [existing] = await tx
            .select({ id: products.id })
            .from(products)
            .where(
              and(
                eq(products.id, productId),
                eq(products.merchantId, merchantId),
              ),
            );
          if (!existing) return { product: null, reason: 'NOT_FOUND' as const };
        }
        const [updated] = await tx
          .update(products)
          .set({
            published: body.published,
            publicationChangedAt: new Date(),
            publicationChangedBy: request.auth?.userId,
          })
          .where(
            and(
              eq(products.id, productId),
              eq(products.merchantId, merchantId),
            ),
          )
          .returning(productFields);
        return { product: updated };
      });
      if (!result.product) {
        const reason = 'reason' in result ? result.reason : 'NOT_FOUND';
        return reply
          .code(reason === 'NOT_FOUND' ? 404 : 400)
          .send({ code: reason });
      }
      return result.product;
    },
  );
  app.post(
    '/v1/merchants/:merchantId/products/publication',
    { preHandler: [requireSameOrigin, requireRole('owner', 'editor')] },
    async (request, reply) => {
      const { merchantId } = request.params as Params;
      const parsedBody = bulkPublicationChangeSchema.safeParse(request.body);
      if (!parsedBody.success)
        return reply.code(400).send({ code: 'INVALID_INPUT' });
      const body = parsedBody.data;
      const db = app.authApi.db;
      if (!db) return reply.code(503).send({ code: 'AUTH_UNAVAILABLE' });
      const result = await db.transaction(async (tx) => {
        await setTenantContext(tx, merchantId);
        if (body.published) {
          for (const productId of body.productIds ?? []) {
            const check = await canPublish(tx, merchantId, productId);
            if (!check.product) return { error: check, productId };
          }
        }
        await tx
          .update(products)
          .set({
            published: body.published,
            publicationChangedAt: new Date(),
            publicationChangedBy: request.auth?.userId,
          })
          .where(
            and(
              eq(products.merchantId, merchantId),
              inArray(products.id, body.productIds ?? []),
            ),
          );
        return { updated: body.productIds?.length ?? 0 };
      });
      if ('error' in result && result.error)
        return reply
          .code(result.error.reason === 'NOT_FOUND' ? 404 : 400)
          .send({ code: result.error.reason, productId: result.productId });
      return result;
    },
  );
}
