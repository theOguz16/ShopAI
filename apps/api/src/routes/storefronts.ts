import {
  publicStorefrontSchema,
  storefrontSlugSchema,
} from '@shopai/contracts';
import { merchants } from '@shopai/db';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

export async function registerStorefrontRoutes(app: FastifyInstance) {
  app.get('/v1/storefronts/:slug', async (request, reply) => {
    const parsedSlug = storefrontSlugSchema.safeParse(
      (request.params as { slug?: string }).slug,
    );
    if (!parsedSlug.success)
      return reply.code(404).send({ code: 'STOREFRONT_NOT_FOUND' });

    const db = app.authApi.db;
    if (!db)
      return reply.code(503).send({ code: 'STOREFRONT_LOOKUP_UNAVAILABLE' });

    const storefront = await db.transaction(async (tx) => {
      await tx.execute(sql`set local role shopai_public`);
      const [row] = await tx
        .select({
          id: merchants.id,
          slug: merchants.slug,
          displayName: sql<string>`coalesce(${merchants.displayName}, ${merchants.name})`,
          logoUrl: merchants.logoUrl,
          coverImageUrl: merchants.coverImageUrl,
          primaryColor: merchants.primaryColor,
          isPublic: merchants.isPublic,
        })
        .from(merchants)
        .where(
          and(
            eq(merchants.slug, parsedSlug.data),
            eq(merchants.active, true),
            eq(merchants.isPublic, true),
          ),
        )
        .limit(1);
      return row;
    });

    return storefront
      ? { storefront: publicStorefrontSchema.parse(storefront) }
      : reply.code(404).send({ code: 'STOREFRONT_NOT_FOUND' });
  });
}
