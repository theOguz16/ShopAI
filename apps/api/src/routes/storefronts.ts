import { buildCategoryFacetMap } from '@shopai/commerce/category-facets';
import {
  publicStorefrontSchema,
  storefrontSlugSchema,
} from '@shopai/contracts';
import {
  categoryFacetsResponseSchema,
  categorySlugSchema,
} from '@shopai/contracts/category-facets';
import { categories, categoryFacets, merchants } from '@shopai/db';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

export async function registerStorefrontRoutes(app: FastifyInstance) {
  app.get('/categories/:slug/facets', async (request, reply) => {
    const parsedSlug = categorySlugSchema.safeParse(
      (request.params as { slug?: string }).slug,
    );
    if (!parsedSlug.success)
      return reply.code(404).send({ code: 'CATEGORY_NOT_FOUND' });

    const db = app.authApi.db;
    if (!db)
      return reply.code(503).send({ code: 'CATEGORY_LOOKUP_UNAVAILABLE' });

    const [category] = await db
      .select({ slug: categories.slug })
      .from(categories)
      .where(eq(categories.slug, parsedSlug.data))
      .limit(1);
    if (!category) return reply.code(404).send({ code: 'CATEGORY_NOT_FOUND' });

    const rows = await db
      .select({ key: categoryFacets.key, options: categoryFacets.options })
      .from(categoryFacets)
      .where(eq(categoryFacets.categorySlug, category.slug))
      .orderBy(asc(categoryFacets.position), asc(categoryFacets.key));

    return categoryFacetsResponseSchema.parse(buildCategoryFacetMap(rows));
  });

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
