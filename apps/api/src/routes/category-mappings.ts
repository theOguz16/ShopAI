import { buildCategoryFacetMap } from '@shopai/commerce/category-facets';
import {
  categories,
  categoryFacets,
  setTenantContext,
  sourceCategoryMappings,
} from '@shopai/db';
import { and, asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole, requireSameOrigin } from '../plugins/auth.js';

type MerchantParams = { merchantId: string };
type MappingParams = MerchantParams & { mappingId: string };
type FacetParams = { slug: string };

const listQuerySchema = z
  .object({
    status: z.enum(['all', 'mapped', 'unmapped']).default('all'),
  })
  .strict();

const mappingUpdateSchema = z
  .object({
    canonicalCategoryKey: z.string().trim().min(1).max(80).nullable(),
  })
  .strict();

export async function registerCategoryMappingRoutes(app: FastifyInstance) {
  app.get(
    '/v1/merchants/:merchantId/category-mappings',
    { preHandler: requireRole('owner', 'editor', 'viewer') },
    async (request, reply) => {
      const parsed = listQuerySchema.safeParse(request.query);
      if (!parsed.success)
        return reply.code(400).send({ code: 'INVALID_INPUT' });
      const { merchantId } = request.params as MerchantParams;
      const db = app.authApi.db;
      if (!db) return reply.code(503).send({ code: 'AUTH_UNAVAILABLE' });

      return db.transaction(async (tx) => {
        await setTenantContext(tx, merchantId);
        const conditions = [eq(sourceCategoryMappings.merchantId, merchantId)];
        if (parsed.data.status === 'mapped')
          conditions.push(eq(sourceCategoryMappings.status, 'mapped'));
        if (parsed.data.status === 'unmapped')
          conditions.push(eq(sourceCategoryMappings.status, 'needs_mapping'));

        const mappings = await tx
          .select({
            id: sourceCategoryMappings.id,
            merchantId: sourceCategoryMappings.merchantId,
            connectionId: sourceCategoryMappings.connectionId,
            provider: sourceCategoryMappings.provider,
            sourceCategoryId: sourceCategoryMappings.sourceCategoryId,
            sourceCategoryName: sourceCategoryMappings.sourceCategoryName,
            sourceCategoryPath: sourceCategoryMappings.sourceCategoryPath,
            canonicalCategoryKey:
              sourceCategoryMappings.canonicalCategorySlug,
            canonicalCategoryLabel: categories.name,
            status: sourceCategoryMappings.status,
            updatedAt: sourceCategoryMappings.updatedAt,
          })
          .from(sourceCategoryMappings)
          .leftJoin(
            categories,
            eq(categories.slug, sourceCategoryMappings.canonicalCategorySlug),
          )
          .where(and(...conditions))
          .orderBy(
            asc(sourceCategoryMappings.provider),
            asc(sourceCategoryMappings.sourceCategoryName),
            asc(sourceCategoryMappings.sourceCategoryId),
          );

        const canonicalCategories = await tx
          .select({
            key: categories.slug,
            label: categories.name,
            parentKey: categories.parentSlug,
            active: categories.active,
          })
          .from(categories)
          .where(eq(categories.active, true))
          .orderBy(asc(categories.parentSlug), asc(categories.name));

        return {
          mappings: mappings.map((mapping) => ({
            ...mapping,
            status:
              mapping.status === 'mapped'
                ? ('mapped' as const)
                : ('unmapped' as const),
            updatedAt: mapping.updatedAt.toISOString(),
          })),
          categories: canonicalCategories,
        };
      });
    },
  );

  app.put(
    '/v1/merchants/:merchantId/category-mappings/:mappingId',
    { preHandler: [requireSameOrigin, requireRole('owner', 'editor')] },
    async (request, reply) => {
      const parsed = mappingUpdateSchema.safeParse(request.body);
      if (!parsed.success)
        return reply.code(400).send({ code: 'INVALID_INPUT' });
      const { merchantId, mappingId } = request.params as MappingParams;
      const db = app.authApi.db;
      if (!db) return reply.code(503).send({ code: 'AUTH_UNAVAILABLE' });

      return db.transaction(async (tx) => {
        await setTenantContext(tx, merchantId);
        const [existing] = await tx
          .select()
          .from(sourceCategoryMappings)
          .where(
            and(
              eq(sourceCategoryMappings.id, mappingId),
              eq(sourceCategoryMappings.merchantId, merchantId),
            ),
          );
        if (!existing) return reply.code(404).send({ code: 'NOT_FOUND' });

        const canonicalCategoryKey = parsed.data.canonicalCategoryKey;
        if (canonicalCategoryKey) {
          const [category] = await tx
            .select({ key: categories.slug })
            .from(categories)
            .where(
              and(
                eq(categories.slug, canonicalCategoryKey),
                eq(categories.active, true),
              ),
            );
          if (!category)
            return reply.code(400).send({ code: 'INVALID_CATEGORY' });
        }

        const nextStatus = canonicalCategoryKey ? 'mapped' : 'needs_mapping';
        if (
          existing.canonicalCategorySlug === canonicalCategoryKey &&
          existing.status === nextStatus
        )
          return {
            id: existing.id,
            canonicalCategoryKey: existing.canonicalCategorySlug,
            status: existing.status === 'mapped' ? 'mapped' : 'unmapped',
            updatedAt: existing.updatedAt.toISOString(),
          };

        const [updated] = await tx
          .update(sourceCategoryMappings)
          .set({
            canonicalCategorySlug: canonicalCategoryKey,
            status: nextStatus,
            updatedAt: new Date(),
            updatedBy: request.auth?.userId ?? null,
          })
          .where(
            and(
              eq(sourceCategoryMappings.id, mappingId),
              eq(sourceCategoryMappings.merchantId, merchantId),
            ),
          )
          .returning();
        if (!updated) return reply.code(404).send({ code: 'NOT_FOUND' });
        return {
          id: updated.id,
          canonicalCategoryKey: updated.canonicalCategorySlug,
          status: updated.status === 'mapped' ? 'mapped' : 'unmapped',
          updatedAt: updated.updatedAt.toISOString(),
        };
      });
    },
  );

  app.get('/categories/:slug/facets', async (request, reply) => {
    const { slug } = request.params as FacetParams;
    const db = app.authApi.db;
    if (!db) return reply.code(503).send({ code: 'AUTH_UNAVAILABLE' });
    const [category] = await db
      .select({ key: categories.slug })
      .from(categories)
      .where(and(eq(categories.slug, slug), eq(categories.active, true)));
    if (!category) return reply.code(404).send({ code: 'NOT_FOUND' });
    const rows = await db
      .select({ key: categoryFacets.key, options: categoryFacets.options })
      .from(categoryFacets)
      .where(
        and(
          eq(categoryFacets.categorySlug, slug),
          eq(categoryFacets.active, true),
        ),
      )
      .orderBy(asc(categoryFacets.position));
    return buildCategoryFacetMap(
      rows.filter(
        (row) => Array.isArray(row.options) && row.options.length > 0,
      ),
    );
  });

  app.get('/v1/categories/:slug/facet-definitions', async (request, reply) => {
    const { slug } = request.params as FacetParams;
    const db = app.authApi.db;
    if (!db) return reply.code(503).send({ code: 'AUTH_UNAVAILABLE' });
    const rows = await db
      .select({
        key: categoryFacets.key,
        label: categoryFacets.label,
        attributeScope: categoryFacets.attributeScope,
        attributeKey: categoryFacets.attributeKey,
        unit: categoryFacets.unit,
        position: categoryFacets.position,
      })
      .from(categoryFacets)
      .innerJoin(categories, eq(categories.slug, categoryFacets.categorySlug))
      .where(
        and(
          eq(categoryFacets.categorySlug, slug),
          eq(categoryFacets.active, true),
          eq(categories.active, true),
        ),
      )
      .orderBy(asc(categoryFacets.position), asc(categoryFacets.key));
    if (!rows.length) {
      const [category] = await db
        .select({ key: categories.slug })
        .from(categories)
        .where(and(eq(categories.slug, slug), eq(categories.active, true)));
      if (!category) return reply.code(404).send({ code: 'NOT_FOUND' });
    }
    return rows;
  });
}
