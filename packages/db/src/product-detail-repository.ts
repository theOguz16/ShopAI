import type {
  ProductDetailRepository,
  ProductDetailRepositoryContext,
  ProductDetailSnapshot,
} from '@shopai/commerce/product-detail';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from './client.js';
import { productAttributes } from './category-model.js';
import {
  inventory,
  merchants,
  offers,
  products,
  variants,
} from './schema.js';

export class PostgresProductDetailRepository implements ProductDetailRepository {
  constructor(private readonly db: Database) {}

  async findProductDetail(
    productId: string,
    context: ProductDetailRepositoryContext = {},
  ): Promise<ProductDetailSnapshot | null> {
    if (context.merchantIds && context.merchantIds.length === 0) return null;

    return this.db.transaction(async (tx) => {
      await tx.execute(sql`set local role shopai_public`);

      const predicates = [
        eq(products.id, productId),
        eq(products.published, true),
        eq(merchants.active, true),
        eq(merchants.isPublic, true),
      ];
      if (context.merchantIds)
        predicates.push(inArray(merchants.id, context.merchantIds));

      const [base] = await tx
        .select({
          productId: products.id,
          title: products.title,
          description: products.description,
          category: products.category,
          imageUrl: products.imageUrl,
          imageAlt: products.imageAlt,
          merchantId: merchants.id,
          merchantName: merchants.name,
          merchantSlug: merchants.slug,
          merchantDisplayName: merchants.displayName,
          merchantLogoUrl: merchants.logoUrl,
        })
        .from(products)
        .innerJoin(merchants, eq(merchants.id, products.merchantId))
        .where(and(...predicates))
        .limit(1);
      if (!base) return null;

      const variantRows = await tx
        .select({
          id: variants.id,
          size: variants.size,
          color: variants.color,
        })
        .from(variants)
        .where(
          and(
            eq(variants.productId, base.productId),
            eq(variants.merchantId, base.merchantId),
          ),
        )
        .orderBy(asc(variants.color), asc(variants.size), asc(variants.id));

      const offerRows = await tx
        .select({
          id: offers.id,
          variantId: offers.variantId,
          priceMinor: offers.priceMinor,
          currency: offers.currency,
          checkoutUrl: offers.checkoutUrl,
          offerObservedAt: offers.observedAt,
          available: inventory.available,
          stockObservedAt: inventory.fetchedAt,
        })
        .from(offers)
        .innerJoin(
          variants,
          and(
            eq(variants.id, offers.variantId),
            eq(variants.merchantId, offers.merchantId),
          ),
        )
        .innerJoin(
          products,
          and(
            eq(products.id, variants.productId),
            eq(products.merchantId, variants.merchantId),
          ),
        )
        .innerJoin(merchants, eq(merchants.id, products.merchantId))
        .leftJoin(
          inventory,
          and(
            eq(inventory.offerId, offers.id),
            eq(inventory.merchantId, offers.merchantId),
          ),
        )
        .where(
          and(
            eq(products.id, base.productId),
            eq(products.merchantId, base.merchantId),
            eq(products.published, true),
            eq(merchants.active, true),
            eq(merchants.isPublic, true),
            eq(offers.active, true),
          ),
        )
        .orderBy(asc(offers.priceMinor), asc(offers.id));

      const attributeRows = await tx
        .select({
          key: productAttributes.key,
          value: productAttributes.value,
        })
        .from(productAttributes)
        .where(
          and(
            eq(productAttributes.productId, base.productId),
            eq(productAttributes.merchantId, base.merchantId),
          ),
        )
        .orderBy(asc(productAttributes.key), asc(productAttributes.value));

      const attributes: Record<string, string[]> = {};
      for (const row of attributeRows)
        (attributes[row.key] ??= []).push(row.value);

      return {
        product: {
          id: base.productId,
          title: base.title,
          description: base.description,
          category: base.category,
          imageUrl: base.imageUrl,
          imageAlt: base.imageAlt,
        },
        merchant: {
          id: base.merchantId,
          name: base.merchantName,
          slug: base.merchantSlug,
          displayName: base.merchantDisplayName ?? base.merchantName,
          logoUrl: base.merchantLogoUrl,
        },
        attributes,
        variants: variantRows,
        offers: offerRows.map((row) => ({
          id: row.id,
          variantId: row.variantId,
          priceMinor: row.priceMinor,
          currency: 'TRY' as const,
          available: row.available ?? null,
          offerObservedAt: row.offerObservedAt.toISOString(),
          stockObservedAt: row.stockObservedAt?.toISOString() ?? null,
          checkoutUrl: row.checkoutUrl,
        })),
      };
    });
  }
}
