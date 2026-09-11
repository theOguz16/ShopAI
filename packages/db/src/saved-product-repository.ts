import type {
  SavedProduct,
  SaveProductRequest,
} from '@shopai/contracts/saved-products';
import { savedProductSchema } from '@shopai/contracts/saved-products';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import {
  check,
  index,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { Database } from './client.js';
import { merchants, products, users, variants } from './schema.js';

const at = (name: string) =>
  timestamp(name, { withTimezone: true, mode: 'date' });

export type ShopperIdentity =
  | { userId: string; anonymousUserId?: never }
  | { anonymousUserId: string; userId?: never };

export const savedProducts = pgTable(
  'saved_products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    anonymousUserId: uuid('anonymous_user_id'),
    productId: uuid('product_id').notNull(),
    variantId: uuid('variant_id'),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (t) => [
    check(
      'saved_products_identity_exactly_one',
      sql`(${t.userId} is not null and ${t.anonymousUserId} is null) or (${t.userId} is null and ${t.anonymousUserId} is not null)`,
    ),
    uniqueIndex('saved_products_identity_product_variant_unique').on(
      sql`coalesce(${t.userId}, ${t.anonymousUserId})`,
      t.productId,
      sql`coalesce(${t.variantId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
    ),
    index('saved_products_user_created').on(t.userId, t.createdAt),
    index('saved_products_anonymous_created').on(
      t.anonymousUserId,
      t.createdAt,
    ),
  ],
);

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

function identityWhere(identity: ShopperIdentity) {
  return 'userId' in identity
    ? and(
        eq(savedProducts.userId, identity.userId),
        isNull(savedProducts.anonymousUserId),
      )
    : and(
        eq(savedProducts.anonymousUserId, identity.anonymousUserId),
        isNull(savedProducts.userId),
      );
}

function savedProductWhere(
  identity: ShopperIdentity,
  input: SaveProductRequest,
) {
  return and(
    identityWhere(identity),
    eq(savedProducts.productId, input.productId),
    input.variantId
      ? eq(savedProducts.variantId, input.variantId)
      : isNull(savedProducts.variantId),
  );
}

export class PostgresSavedProductRepository {
  constructor(private readonly db: Database) {}

  async save(
    identity: ShopperIdentity,
    input: SaveProductRequest,
  ): Promise<SavedProduct> {
    return this.db.transaction(async (tx) => {
      await this.scope(tx, identity);
      await this.requirePublicTarget(tx, input);
      await tx
        .insert(savedProducts)
        .values({
          userId: 'userId' in identity ? identity.userId : null,
          anonymousUserId:
            'anonymousUserId' in identity ? identity.anonymousUserId : null,
          productId: input.productId,
          variantId: input.variantId ?? null,
        })
        .onConflictDoNothing();
      const [saved] = await tx
        .select({ id: savedProducts.id })
        .from(savedProducts)
        .where(savedProductWhere(identity, input))
        .limit(1);
      if (!saved) throw new Error('Kaydedilen ürün oluşturulamadı.');
      const item = await this.selectOne(tx, identity, saved.id);
      if (!item) throw new Error('Kaydedilen ürün okunamadı.');
      return item;
    });
  }

  async list(identity: ShopperIdentity): Promise<SavedProduct[]> {
    return this.db.transaction(async (tx) => {
      await this.scope(tx, identity);
      return this.selectMany(tx, identity);
    });
  }

  private async requirePublicTarget(tx: Tx, input: SaveProductRequest) {
    const [product] = await tx
      .select({ id: products.id })
      .from(products)
      .innerJoin(merchants, eq(merchants.id, products.merchantId))
      .where(
        and(
          eq(products.id, input.productId),
          eq(products.published, true),
          eq(merchants.active, true),
          eq(merchants.isPublic, true),
        ),
      )
      .limit(1);
    if (!product)
      throw Object.assign(new Error('Kaydedilecek ürün bulunamadı.'), {
        statusCode: 404,
        code: 'PRODUCT_NOT_FOUND',
      });
    if (!input.variantId) return;
    const [variant] = await tx
      .select({ id: variants.id })
      .from(variants)
      .where(
        and(
          eq(variants.id, input.variantId),
          eq(variants.productId, input.productId),
        ),
      )
      .limit(1);
    if (!variant)
      throw Object.assign(new Error('Varyant ürüne ait değil.'), {
        statusCode: 400,
        code: 'VARIANT_PRODUCT_MISMATCH',
      });
  }

  private async selectOne(
    tx: Tx,
    identity: ShopperIdentity,
    id: string,
  ): Promise<SavedProduct | null> {
    const rows = await this.selectMany(tx, identity, id);
    return rows[0] ?? null;
  }

  private async selectMany(
    tx: Tx,
    identity: ShopperIdentity,
    id?: string,
  ): Promise<SavedProduct[]> {
    const rows = await tx
      .select({
        id: savedProducts.id,
        productId: savedProducts.productId,
        variantId: savedProducts.variantId,
        createdAt: savedProducts.createdAt,
        title: products.title,
        imageUrl: products.imageUrl,
        imageAlt: products.imageAlt,
        published: products.published,
        merchantName: merchants.name,
        merchantDisplayName: merchants.displayName,
        merchantSlug: merchants.slug,
        merchantActive: merchants.active,
        merchantPublic: merchants.isPublic,
        liveVariantId: variants.id,
        variantSize: variants.size,
        variantColor: variants.color,
      })
      .from(savedProducts)
      .leftJoin(products, eq(products.id, savedProducts.productId))
      .leftJoin(merchants, eq(merchants.id, products.merchantId))
      .leftJoin(
        variants,
        and(
          eq(variants.id, savedProducts.variantId),
          eq(variants.productId, savedProducts.productId),
        ),
      )
      .where(
        and(identityWhere(identity), id ? eq(savedProducts.id, id) : undefined),
      )
      .orderBy(desc(savedProducts.createdAt), desc(savedProducts.id));

    return rows.map((row) => {
      const productAvailable =
        row.published === true &&
        row.merchantActive === true &&
        row.merchantPublic === true;
      const variantAvailable =
        row.variantId === null || row.liveVariantId === row.variantId;
      const available = productAvailable && variantAvailable;
      return savedProductSchema.parse({
        id: row.id,
        productId: row.productId,
        variantId: row.variantId,
        createdAt: row.createdAt.toISOString(),
        available,
        product: productAvailable
          ? {
              title: row.title,
              imageUrl: row.imageUrl,
              imageAlt: row.imageAlt,
              merchantName: row.merchantDisplayName ?? row.merchantName,
              merchantSlug: row.merchantSlug,
            }
          : null,
        variant:
          row.variantId && row.liveVariantId === row.variantId
            ? { size: row.variantSize ?? '', color: row.variantColor ?? '' }
            : null,
      });
    });
  }

  private async scope(tx: Tx, identity: ShopperIdentity) {
    await tx.execute(sql`set local role shopai_public`);
    await tx.execute(
      sql`select set_config('app.user_id', ${'userId' in identity ? identity.userId : ''}, true)`,
    );
    await tx.execute(
      sql`select set_config('app.anonymous_user_id', ${'anonymousUserId' in identity ? identity.anonymousUserId : ''}, true)`,
    );
  }
}
