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
import { catalogItemSchema } from '@shopai/contracts';
import {
  and,
  asc,
  count,
  eq,
  gt,
  gte,
  inArray,
  lte,
  notInArray,
  or,
  sql,
} from 'drizzle-orm';
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
  }: ResolvedSearchRequest & { tenantId?: string }) {
    // Public search deliberately has no tenant scope; PostgreSQL app_public RLS
    // exposes only published catalog rows. Management callers must pass a tenant.
    if (tenantId !== undefined) requireTenantId(tenantId);
    const predicates = [
      eq(m.active, true),
      eq(p.published, true),
      eq(o.active, true),
      eq(o.currency, f.currency),
    ];
    if (matchNone) predicates.push(sql`false`);
    const normalizedDocument = sql<string>`translate(lower(${p.title} || ' ' || ${p.description}), 'ıİğĞüÜşŞöÖçÇ', 'iigguussoocc')`;
    for (const term of textTerms)
      predicates.push(sql`${normalizedDocument} like ${`%${term}%`}`);
    if (merchantIds.length) predicates.push(inArray(m.id, merchantIds));
    if (f.category)
      predicates.push(eq(p.category, normalizeCategory(f.category)));
    if (f.excludedCategories.length)
      predicates.push(
        notInArray(p.category, f.excludedCategories.map(normalizeCategory)),
      );
    if (f.sizes.length)
      predicates.push(inArray(v.size, f.sizes.map(normalizeSize)));
    if (f.excludedSizes.length)
      predicates.push(notInArray(v.size, f.excludedSizes.map(normalizeSize)));
    if (f.colors.length)
      predicates.push(inArray(v.color, f.colors.map(normalizeColor)));
    if (f.excludedColors.length)
      predicates.push(
        notInArray(v.color, f.excludedColors.map(normalizeColor)),
      );
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
      // Public search runs as the restricted DB role, even when the pool login
      // is the management role. SET LOCAL is cleared when this transaction ends.
      await tx.execute(sql`set local role shopai_public`);
      const categoryFacets = await tx
        .select({ value: p.category, count: count() })
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
        .groupBy(p.category)
        .orderBy(asc(p.category));
      const sizeFacets = await tx
        .select({ value: v.size, count: count() })
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
        .groupBy(v.size)
        .orderBy(asc(v.size));
      const colorFacets = await tx
        .select({ value: v.color, count: count() })
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
        .groupBy(v.color)
        .orderBy(asc(v.color));
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
          imageUrl: p.imageUrl,
          imageAlt: p.imageAlt,
          size: v.size,
          color: v.color,
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
        .where(and(...predicates, cursorPredicate))
        .orderBy(asc(o.priceMinor), asc(o.id))
        .limit(limit + 1);
      const hasMore = rows.length > limit;
      const items = rows.slice(0, limit).map((r) =>
        catalogItemSchema.parse({
          ...r,
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
          categories: categoryFacets,
          sizes: sizeFacets,
          colors: colorFacets,
        },
      };
    });
  }
}
