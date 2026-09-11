import {
  AnonymousShoppingProfiles,
  type AnonymousShoppingProfileRepository,
} from '@shopai/commerce/anonymous-shopping-profile';
import { buildCategoryFacetMap } from '@shopai/commerce/category-facets';
import type { AnonymousShoppingProfile } from '@shopai/contracts/anonymous-shopping-profile';
import { anonymousShoppingProfileUpdateSchema } from '@shopai/contracts/anonymous-shopping-profile';
import {
  publicStorefrontSchema,
  storefrontSlugSchema,
} from '@shopai/contracts';
import {
  categoryFacetsResponseSchema,
  categorySlugSchema,
} from '@shopai/contracts/category-facets';
import {
  categories,
  categoryFacets,
  merchants,
  PostgresAnonymousShoppingProfileRepository,
} from '@shopai/db';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { ensureAnonymousUserId } from '../plugins/anonymous-user.js';
import { requireSameOrigin } from '../plugins/auth.js';

class MemoryAnonymousShoppingProfileRepository
  implements AnonymousShoppingProfileRepository
{
  private readonly rows = new Map<string, AnonymousShoppingProfile>();

  async getOrCreate(anonymousUserId: string) {
    const existing = this.rows.get(anonymousUserId);
    if (existing) return existing;
    const now = new Date().toISOString();
    const row: AnonymousShoppingProfile = {
      anonymousUserId,
      preferredSizes: {},
      preferredColors: {},
      preferredStyles: {},
      preferredPriceRanges: {},
      createdAt: now,
      updatedAt: now,
    };
    this.rows.set(anonymousUserId, row);
    return row;
  }

  async replace(profile: AnonymousShoppingProfile) {
    this.rows.set(profile.anonymousUserId, profile);
    return profile;
  }
}

export async function registerStorefrontRoutes(app: FastifyInstance) {
  const profileRepository: AnonymousShoppingProfileRepository = app.authApi.db
    ? new PostgresAnonymousShoppingProfileRepository(app.authApi.db)
    : new MemoryAnonymousShoppingProfileRepository();
  const shoppingProfiles = new AnonymousShoppingProfiles(profileRepository);

  app.addHook('preValidation', async (request, reply) => {
    if (
      request.method !== 'POST' ||
      request.url.split('?')[0] !== '/discovery-session' ||
      !request.body ||
      typeof request.body !== 'object' ||
      Array.isArray(request.body)
    )
      return;
    const anonymousUserId = ensureAnonymousUserId(request, reply);
    request.body = {
      ...(request.body as Record<string, unknown>),
      anonymousUserId,
    };
  });

  app.get('/v1/shopping-profile', async (request, reply) => {
    const anonymousUserId = ensureAnonymousUserId(request, reply);
    return shoppingProfiles.getOrCreate(anonymousUserId);
  });

  app.put(
    '/v1/shopping-profile',
    { preHandler: requireSameOrigin },
    async (request, reply) => {
      const parsed = anonymousShoppingProfileUpdateSchema.safeParse(
        request.body,
      );
      if (!parsed.success)
        return reply
          .code(400)
          .send({ code: 'INVALID_INPUT', requestId: request.id });
      const anonymousUserId = ensureAnonymousUserId(request, reply);
      return shoppingProfiles.update(anonymousUserId, parsed.data);
    },
  );

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
