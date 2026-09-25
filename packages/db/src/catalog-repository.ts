import {
  type CatalogRepository,
  decodeSearchCursor,
  encodeSearchCursor,
  normalizeCategory,
  normalizeColor,
  normalizeSize,
  type ResolvedSearchRequest,
  STOCK_STALE_AFTER_MS,
  stockStatus,
} from '@shopai/commerce';
import { buildCanonicalFacetValues } from '@shopai/commerce/category-facets';
import { catalogItemSchema } from '@shopai/contracts';
import {
  and,
  asc,
  eq,
  exists,
  gt,
  gte,
  inArray,
  lte,
  notInArray,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import {
  categories as cat,
  categoryFacets as cf,
  sourceCategoryMappings as cm,
} from './category-model.js';
import type { Database } from './client.js';
import {
  inventory as i,
  merchants as m,
  offers as o,
  products as p,
  variants as v,
} from './schema.js';
import { requireTenantId } from './tenant-context.js';

export class PostgresCatalogRepository implements CatalogRepository {
  constructor(private readonly db: Database) {}

  async health() {
    await this.db.execute(sql`select 1`);
  }

  async search({
    textTerms,
    filters: f,
    merchantIds,
    limit,
    cursor,
    matchNone,
    tenantId,
    legacyCategory,
  }: ResolvedSearchRequest & { tenantId?: string }) {
    if (tenantId !== undefined) requireTenantId(tenantId);

    const predicates = [
      eq(m.active, true),
      eq(m.isPublic, true),
      eq(p.published, true),
      eq(o.active, true),
      eq(o.currency, f.currency),
    ];
    if (matchNone) predicates.push(sql`false`);

    const normalizedDocument = sql<string>`translate(lower(${p.title} || ' ' || ${p.description}), 'ıİğĞüÜşŞöÖçÇ', 'iigguussoocc')`;
    for (const term of textTerms)
      predicates.push(sql`${normalizedDocument} like ${`%${term}%`}`);
    if (merchantIds.length) predicates.push(inArray(m.id, merchantIds));

    // Canonical category predicates reference the mapping join and are applied
    // outside the search base subquery (see the transaction below). The rows
    // query uses the correlated EXISTS forms: letting the planner reach the
    // mapping tables through a join predicate lets it reorder the join tree
    // into per-row RLS re-evaluation on large catalogs.
    const mappingPredicates: SQL[] = [];
    const rowsMappingPredicates: SQL[] = [];
    const mappedCategoryMatches = (category: string) =>
      exists(
        this.db
          .select({ one: sql`1` })
          .from(cm)
          .innerJoin(cat, eq(cat.slug, cm.canonicalCategorySlug))
          .where(
            and(
              eq(cm.merchantId, p.merchantId),
              eq(cm.connectionId, p.connectionId),
              eq(cm.provider, p.sourceCategoryProvider),
              eq(cm.sourceCategoryId, p.sourceCategoryId),
              eq(cm.status, 'mapped'),
              eq(cat.active, true),
              or(eq(cat.slug, category), eq(cat.parentSlug, category)),
            ),
          ),
      );
    if (f.category) {
      const category = normalizeCategory(f.category);
      mappingPredicates.push(sql`
        ${cm.status} = 'mapped'
        AND ${cat.active} = true
        AND (${cat.slug} = ${category} OR ${cat.parentSlug} = ${category})
      `);
      rowsMappingPredicates.push(mappedCategoryMatches(category));
    }
    for (const excludedCategory of f.excludedCategories) {
      const category = normalizeCategory(excludedCategory);
      mappingPredicates.push(sql`
        NOT (
          ${cm.status} = 'mapped'
          AND ${cat.active} = true
          AND (${cat.slug} = ${category} OR ${cat.parentSlug} = ${category})
        )
      `);
      rowsMappingPredicates.push(sql`not ${mappedCategoryMatches(category)}`);
    }
    if (legacyCategory)
      predicates.push(eq(p.category, normalizeCategory(legacyCategory)));

    if (f.sizes.length) {
      const genericSize = or(
        ...f.sizes.map((value) => {
          const serialized = JSON.stringify([{ key: 'size', value }]);
          return sql`${v.options} @> ${serialized}::jsonb`;
        }),
      );
      const sizePredicate = or(
        inArray(v.size, f.sizes.map(normalizeSize)),
        genericSize,
      );
      if (sizePredicate) predicates.push(sizePredicate);
    }
    if (f.excludedSizes.length)
      predicates.push(notInArray(v.size, f.excludedSizes.map(normalizeSize)));
    if (f.colors.length) {
      const genericColor = or(
        ...f.colors.map((value) => {
          const serialized = JSON.stringify([{ key: 'color', value }]);
          return sql`${v.options} @> ${serialized}::jsonb`;
        }),
      );
      const colorPredicate = or(
        inArray(v.color, f.colors.map(normalizeColor)),
        genericColor,
      );
      if (colorPredicate) predicates.push(colorPredicate);
    }
    if (f.excludedColors.length)
      predicates.push(
        notInArray(v.color, f.excludedColors.map(normalizeColor)),
      );

    for (const [key, values] of Object.entries(f.attributes ?? {})) {
      const alternatives = values.map((value) => {
        const serialized = JSON.stringify([{ key, value }]);
        return sql`(
          ${v.options} @> ${serialized}::jsonb
          OR ${p.descriptiveAttributes} @> ${serialized}::jsonb
        )`;
      });
      const attributePredicate = or(...alternatives);
      if (attributePredicate) predicates.push(attributePredicate);
    }

    if (f.minPriceMinor !== undefined)
      predicates.push(gte(o.priceMinor, f.minPriceMinor));
    if (f.maxPriceMinor !== undefined)
      predicates.push(lte(o.priceMinor, f.maxPriceMinor));
    if (f.inStockOnly) {
      predicates.push(eq(i.available, true));
      predicates.push(
        gte(i.fetchedAt, new Date(Date.now() - STOCK_STALE_AFTER_MS)),
      );
    }

    const decodedCursor = decodeSearchCursor(cursor);
    const cursorPredicate = decodedCursor
      ? or(
          gt(o.priceMinor, decodedCursor.priceMinor),
          and(
            eq(o.priceMinor, decodedCursor.priceMinor),
            gt(o.id, decodedCursor.offerId),
          ),
        )
      : undefined;

    return this.db.transaction(async (tx) => {
      await tx.execute(sql`set local role shopai_public`);

      // The mapping joins must stay outside these base subqueries: a LIMIT in
      // the subquery is an optimizer fence that keeps the base join tree in the
      // shape the RLS policies can hoist into hashed subplans. Letting the
      // planner inline the mapping join made it re-evaluate those policies per
      // row on large catalogs (a 10k-product facet query went from ~0.3s to
      // over 30 minutes). drizzle drops offset(0) (falsy), so the fence is a
      // limit that exceeds any real public catalog.
      const searchFenceLimit = Number.MAX_SAFE_INTEGER;

      const categoryFacetsBase = tx
        .select({
          productId: p.id,
          merchantId: p.merchantId,
          connectionId: p.connectionId,
          sourceCategoryProvider: p.sourceCategoryProvider,
          sourceCategoryId: p.sourceCategoryId,
        })
        .from(o)
        .innerJoin(m, eq(m.id, o.merchantId))
        .innerJoin(
          v,
          and(eq(v.id, o.variantId), eq(v.merchantId, o.merchantId)),
        )
        .innerJoin(
          p,
          and(eq(p.id, v.productId), eq(p.merchantId, v.merchantId)),
        )
        .innerJoin(i, and(eq(i.offerId, o.id), eq(i.merchantId, o.merchantId)))
        .where(and(...predicates))
        .limit(searchFenceLimit)
        .as('category_facets_base');

      const categoryFacets = await tx
        .select({
          value: cm.canonicalCategorySlug,
          count: sql<number>`count(distinct ${categoryFacetsBase.productId})::integer`,
        })
        .from(categoryFacetsBase)
        .innerJoin(
          cm,
          and(
            eq(cm.merchantId, categoryFacetsBase.merchantId),
            eq(cm.connectionId, categoryFacetsBase.connectionId),
            eq(cm.provider, categoryFacetsBase.sourceCategoryProvider),
            eq(cm.sourceCategoryId, categoryFacetsBase.sourceCategoryId),
          ),
        )
        .innerJoin(cat, eq(cat.slug, cm.canonicalCategorySlug))
        .where(
          and(
            ...mappingPredicates,
            eq(cm.status, 'mapped'),
            eq(cat.active, true),
          ),
        )
        .groupBy(cm.canonicalCategorySlug)
        .orderBy(asc(cm.canonicalCategorySlug));

      let attributeFacets: ReturnType<typeof buildCanonicalFacetValues> = {};
      if (f.category) {
        const category = normalizeCategory(f.category);
        const definitions = await tx
          .select({
            key: cf.key,
            label: cf.label,
            attributeScope: cf.attributeScope,
            attributeKey: cf.attributeKey,
            unit: cf.unit,
            active: cf.active,
          })
          .from(cf)
          .innerJoin(cat, eq(cat.slug, cf.categorySlug))
          .where(
            and(
              eq(cf.active, true),
              eq(cat.active, true),
              or(eq(cf.categorySlug, category), eq(cat.parentSlug, category)),
            ),
          )
          .orderBy(asc(cf.position), asc(cf.key));

        const facetRecordsBase = tx
          .select({
            productAttributes: p.descriptiveAttributes,
            variantOptions: v.options,
            merchantId: p.merchantId,
            connectionId: p.connectionId,
            sourceCategoryProvider: p.sourceCategoryProvider,
            sourceCategoryId: p.sourceCategoryId,
          })
          .from(o)
          .innerJoin(m, eq(m.id, o.merchantId))
          .innerJoin(
            v,
            and(eq(v.id, o.variantId), eq(v.merchantId, o.merchantId)),
          )
          .innerJoin(
            p,
            and(eq(p.id, v.productId), eq(p.merchantId, v.merchantId)),
          )
          .innerJoin(
            i,
            and(eq(i.offerId, o.id), eq(i.merchantId, o.merchantId)),
          )
          .where(and(...predicates))
          .limit(searchFenceLimit)
          .as('attribute_facets_base');

        const facetRecords = await tx
          .select({
            productAttributes: facetRecordsBase.productAttributes,
            variantOptions: facetRecordsBase.variantOptions,
          })
          .from(facetRecordsBase)
          .innerJoin(
            cm,
            and(
              eq(cm.merchantId, facetRecordsBase.merchantId),
              eq(cm.connectionId, facetRecordsBase.connectionId),
              eq(cm.provider, facetRecordsBase.sourceCategoryProvider),
              eq(cm.sourceCategoryId, facetRecordsBase.sourceCategoryId),
            ),
          )
          .innerJoin(cat, eq(cat.slug, cm.canonicalCategorySlug))
          .where(
            and(
              ...mappingPredicates,
              eq(cm.status, 'mapped'),
              eq(cat.active, true),
            ),
          );

        attributeFacets = buildCanonicalFacetValues(definitions, facetRecords);
      }

      const rows = await tx
        .select({
          productId: p.id,
          variantId: v.id,
          offerId: o.id,
          merchantId: m.id,
          merchantName: m.name,
          title: p.title,
          description: p.description,
          category: p.category,
          sourceCategoryId: p.sourceCategoryId,
          sourceCategoryName: p.sourceCategoryName,
          sourceCategoryPath: p.sourceCategoryPath,
          sourceCategoryProvider: p.sourceCategoryProvider,
          mappingStatus: cm.status,
          canonicalCategorySlug: cm.canonicalCategorySlug,
          canonicalCategoryLabel: cat.name,
          canonicalCategoryParent: cat.parentSlug,
          canonicalCategoryActive: cat.active,
          imageUrl: sql<string | null>`coalesce(${v.imageUrl}, ${p.imageUrl})`,
          imageAlt: sql<string | null>`coalesce(${v.imageAlt}, ${p.imageAlt})`,
          size: v.size,
          color: v.color,
          variantOptions: v.options,
          sourceVariantId: v.externalId,
          priceMinor: o.priceMinor,
          currency: o.currency,
          available: i.available,
          priceSource: sql<string>`'catalog-import'`,
          stockSource: sql<string>`'catalog-import'`,
          priceObservedAt: o.observedAt,
          stockObservedAt: i.fetchedAt,
          observedAt: i.fetchedAt,
          checkoutUrl: o.checkoutUrl,
        })
        .from(o)
        .innerJoin(m, eq(m.id, o.merchantId))
        .innerJoin(
          v,
          and(eq(v.id, o.variantId), eq(v.merchantId, o.merchantId)),
        )
        .innerJoin(
          p,
          and(eq(p.id, v.productId), eq(p.merchantId, v.merchantId)),
        )
        .innerJoin(i, and(eq(i.offerId, o.id), eq(i.merchantId, o.merchantId)))
        .leftJoin(
          cm,
          and(
            eq(cm.merchantId, p.merchantId),
            eq(cm.connectionId, p.connectionId),
            eq(cm.provider, p.sourceCategoryProvider),
            eq(cm.sourceCategoryId, p.sourceCategoryId),
          ),
        )
        .leftJoin(cat, eq(cat.slug, cm.canonicalCategorySlug))
        .where(and(...predicates, ...rowsMappingPredicates, cursorPredicate))
        .orderBy(asc(o.priceMinor), asc(o.id))
        .limit(limit + 1);

      const hasMore = rows.length > limit;
      const items = rows.slice(0, limit).map((r) =>
        catalogItemSchema.parse({
          ...r,
          sourceCategory: r.sourceCategoryName
            ? {
                id: r.sourceCategoryId,
                name: r.sourceCategoryName,
                path: r.sourceCategoryPath,
                provider: r.sourceCategoryProvider,
              }
            : undefined,
          canonicalCategory:
            r.mappingStatus === 'mapped' &&
            r.canonicalCategorySlug &&
            r.canonicalCategoryLabel &&
            r.canonicalCategoryActive
              ? {
                  key: r.canonicalCategorySlug,
                  label: r.canonicalCategoryLabel,
                  parentKey: r.canonicalCategoryParent,
                }
              : null,
          stockStatus: stockStatus(
            r.available,
            r.stockObservedAt?.toISOString() ?? null,
          ),
          priceObservedAt: r.priceObservedAt?.toISOString() ?? null,
          stockObservedAt: r.stockObservedAt?.toISOString() ?? null,
          observedAt: r.observedAt.toISOString(),
        }),
      );
      const last = items.at(-1);
      return {
        items,
        nextCursor:
          hasMore && last
            ? encodeSearchCursor({
                priceMinor: last.priceMinor,
                offerId: last.offerId,
              })
            : null,
        facets: {
          categories: categoryFacets.flatMap((facet) =>
            facet.value ? [{ value: facet.value, count: facet.count }] : [],
          ),
          sizes: attributeFacets.size?.values ?? [],
          colors: attributeFacets.color?.values ?? [],
          ...(Object.keys(attributeFacets).length
            ? { attributes: attributeFacets }
            : {}),
        },
      };
    });
  }
}
