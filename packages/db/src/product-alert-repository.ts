import {
  buildProductAlertEmail,
  shouldTriggerProductAlert,
} from '@shopai/commerce/product-alerts';
import type {
  CreateProductAlertRequest,
  ProductAlert,
} from '@shopai/contracts/product-alerts';
import { productAlertSchema } from '@shopai/contracts/product-alerts';
import { and, asc, eq, inArray, isNull, min, sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { Database } from './client.js';
import {
  inventory,
  merchants,
  offers,
  products,
  users,
  variants,
} from './schema.js';
import type { ShopperIdentity } from './saved-product-repository.js';

const at = (name: string) =>
  timestamp(name, { withTimezone: true, mode: 'date' });

export const productAlerts = pgTable(
  'product_alerts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    merchantId: uuid('merchant_id').notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    anonymousUserId: uuid('anonymous_user_id'),
    productId: uuid('product_id').notNull(),
    variantId: uuid('variant_id'),
    conditionType: text('condition_type').notNull(),
    targetValue: bigint('target_value', { mode: 'number' }),
    status: text('status').notNull().default('ACTIVE'),
    channel: text('channel').notNull().default('email'),
    deliveryEmail: text('delivery_email').notNull(),
    createdAt: at('created_at').notNull().defaultNow(),
    updatedAt: at('updated_at').notNull().defaultNow(),
    triggeredAt: at('triggered_at'),
  },
  (t) => [
    check(
      'product_alerts_identity_exactly_one',
      sql`(${t.userId} is not null and ${t.anonymousUserId} is null) or (${t.userId} is null and ${t.anonymousUserId} is not null)`,
    ),
    check(
      'product_alerts_condition_type',
      sql`${t.conditionType} in ('PRICE_BELOW','BACK_IN_STOCK')`,
    ),
    check(
      'product_alerts_status',
      sql`${t.status} in ('ACTIVE','TRIGGERED','CANCELLED')`,
    ),
    check('product_alerts_channel', sql`${t.channel} = 'email'`),
    check(
      'product_alerts_condition_shape',
      sql`(${t.conditionType} = 'PRICE_BELOW' and ${t.targetValue} is not null and ${t.targetValue} > 0) or (${t.conditionType} = 'BACK_IN_STOCK' and ${t.targetValue} is null and ${t.variantId} is not null)`,
    ),
    uniqueIndex('product_alerts_active_identity_condition_unique')
      .on(
        sql`coalesce(${t.userId}, ${t.anonymousUserId})`,
        t.productId,
        sql`coalesce(${t.variantId}, ${'00000000-0000-0000-0000-000000000000'}::uuid)`,
        t.conditionType,
        sql`coalesce(${t.targetValue}, -1)`,
      )
      .where(sql`${t.status} = 'ACTIVE'`),
    index('product_alerts_merchant_product_status').on(
      t.merchantId,
      t.productId,
      t.status,
    ),
    index('product_alerts_user_created').on(t.userId, t.createdAt),
    index('product_alerts_anonymous_created').on(
      t.anonymousUserId,
      t.createdAt,
    ),
  ],
);

export const productAlertNotifications = pgTable(
  'product_alert_notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    merchantId: uuid('merchant_id').notNull(),
    alertId: uuid('alert_id')
      .notNull()
      .references(() => productAlerts.id, { onDelete: 'cascade' }),
    channel: text('channel').notNull().default('email'),
    recipient: text('recipient').notNull(),
    subject: text('subject').notNull(),
    body: text('body').notNull(),
    status: text('status').notNull().default('PENDING'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    createdAt: at('created_at').notNull().defaultNow(),
    sentAt: at('sent_at'),
  },
  (t) => [
    uniqueIndex('product_alert_notifications_alert_unique').on(t.alertId),
    check('product_alert_notifications_channel', sql`${t.channel} = 'email'`),
    check(
      'product_alert_notifications_status',
      sql`${t.status} in ('PENDING','SENDING','SENT')`,
    ),
    index('product_alert_notifications_pending').on(
      t.merchantId,
      t.status,
      t.createdAt,
    ),
  ],
);

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

function identityWhere(identity: ShopperIdentity) {
  return identity.kind === 'user'
    ? and(
        eq(productAlerts.userId, identity.userId),
        isNull(productAlerts.anonymousUserId),
      )
    : and(
        eq(productAlerts.anonymousUserId, identity.anonymousUserId),
        isNull(productAlerts.userId),
      );
}

async function scopePublic(tx: Tx, identity: ShopperIdentity) {
  await tx.execute(sql`set local role shopai_public`);
  await tx.execute(
    sql`select set_config('app.user_id', ${identity.kind === 'user' ? identity.userId : ''}, true)`,
  );
  await tx.execute(
    sql`select set_config('app.anonymous_user_id', ${identity.kind === 'anonymous' ? identity.anonymousUserId : ''}, true)`,
  );
}

async function scopeWorker(tx: Tx, merchantId: string) {
  await tx.execute(sql`set local role shopai_worker`);
  await tx.execute(
    sql`select set_config('app.tenant_id', ${merchantId}, true)`,
  );
}

function toAlert(row: typeof productAlerts.$inferSelect): ProductAlert {
  return productAlertSchema.parse({
    id: row.id,
    productId: row.productId,
    variantId: row.variantId,
    conditionType: row.conditionType,
    targetValue: row.targetValue,
    status: row.status,
    channel: row.channel,
    email: row.deliveryEmail,
    createdAt: row.createdAt.toISOString(),
    triggeredAt: row.triggeredAt?.toISOString() ?? null,
  });
}

export class PostgresProductAlertRepository {
  constructor(private readonly db: Database) {}

  async create(
    identity: ShopperIdentity,
    input: CreateProductAlertRequest,
  ): Promise<ProductAlert> {
    return this.db.transaction(async (tx) => {
      await scopePublic(tx, identity);
      const merchantId = await this.requirePublicTarget(tx, input);
      const values = {
        merchantId,
        userId: identity.kind === 'user' ? identity.userId : null,
        anonymousUserId:
          identity.kind === 'anonymous' ? identity.anonymousUserId : null,
        productId: input.productId,
        variantId: input.variantId ?? null,
        conditionType: input.conditionType,
        targetValue:
          input.conditionType === 'PRICE_BELOW'
            ? (input.targetValue ?? null)
            : null,
        deliveryEmail: input.email.toLowerCase(),
      };
      const [inserted] = await tx
        .insert(productAlerts)
        .values(values)
        .onConflictDoNothing()
        .returning();
      if (inserted) return toAlert(inserted);
      const [existing] = await tx
        .select()
        .from(productAlerts)
        .where(
          and(
            identityWhere(identity),
            eq(productAlerts.productId, input.productId),
            input.variantId
              ? eq(productAlerts.variantId, input.variantId)
              : isNull(productAlerts.variantId),
            eq(productAlerts.conditionType, input.conditionType),
            input.conditionType === 'PRICE_BELOW'
              ? eq(productAlerts.targetValue, input.targetValue ?? 0)
              : isNull(productAlerts.targetValue),
            eq(productAlerts.status, 'ACTIVE'),
          ),
        )
        .limit(1);
      if (!existing) throw new Error('Alert oluşturulamadı.');
      return toAlert(existing);
    });
  }

  async list(identity: ShopperIdentity): Promise<ProductAlert[]> {
    return this.db.transaction(async (tx) => {
      await scopePublic(tx, identity);
      const rows = await tx
        .select()
        .from(productAlerts)
        .where(identityWhere(identity))
        .orderBy(asc(productAlerts.createdAt));
      return rows.map(toAlert);
    });
  }

  async cancel(
    identity: ShopperIdentity,
    alertId: string,
  ): Promise<{ cancelled: boolean }> {
    return this.db.transaction(async (tx) => {
      await scopePublic(tx, identity);
      const rows = await tx
        .update(productAlerts)
        .set({ status: 'CANCELLED', updatedAt: new Date() })
        .where(
          and(
            identityWhere(identity),
            eq(productAlerts.id, alertId),
            eq(productAlerts.status, 'ACTIVE'),
          ),
        )
        .returning({ id: productAlerts.id });
      return { cancelled: rows.length > 0 };
    });
  }

  async evaluateForMerchant(
    merchantId: string,
    now: Date = new Date(),
  ): Promise<{ evaluated: number; triggered: number }> {
    return this.db.transaction(async (tx) => {
      await scopeWorker(tx, merchantId);
      const candidates = await tx
        .select({
          alert: productAlerts,
          productTitle: products.title,
          variantSize: variants.size,
          variantColor: variants.color,
        })
        .from(productAlerts)
        .innerJoin(products, eq(products.id, productAlerts.productId))
        .innerJoin(merchants, eq(merchants.id, products.merchantId))
        .leftJoin(variants, eq(variants.id, productAlerts.variantId))
        .where(
          and(
            eq(productAlerts.merchantId, merchantId),
            eq(products.published, true),
            eq(merchants.active, true),
            eq(merchants.isPublic, true),
            eq(productAlerts.status, 'ACTIVE'),
          ),
        );

      let triggered = 0;
      for (const candidate of candidates) {
        const priceFilters = [
          eq(offers.active, true),
          eq(offers.merchantId, merchantId),
        ];
        if (candidate.alert.variantId)
          priceFilters.push(eq(offers.variantId, candidate.alert.variantId));
        else {
          const productVariantIds = tx
            .select({ id: variants.id })
            .from(variants)
            .where(eq(variants.productId, candidate.alert.productId));
          priceFilters.push(inArray(offers.variantId, productVariantIds));
        }
        const [priceRow] = await tx
          .select({ priceMinor: min(offers.priceMinor) })
          .from(offers)
          .where(and(...priceFilters));
        const [stockRow] = candidate.alert.variantId
          ? await tx
              .select({ available: inventory.available })
              .from(offers)
              .innerJoin(inventory, eq(inventory.offerId, offers.id))
              .where(
                and(
                  eq(offers.variantId, candidate.alert.variantId),
                  eq(offers.active, true),
                  eq(inventory.available, true),
                ),
              )
              .limit(1)
          : [];
        const currentPriceMinor =
          priceRow?.priceMinor == null ? null : Number(priceRow.priceMinor);
        if (
          !shouldTriggerProductAlert({
            conditionType: candidate.alert.conditionType as
              | 'PRICE_BELOW'
              | 'BACK_IN_STOCK',
            targetValue: candidate.alert.targetValue,
            currentPriceMinor,
            available: stockRow?.available ?? null,
          })
        )
          continue;

        const [claimed] = await tx
          .update(productAlerts)
          .set({ status: 'TRIGGERED', triggeredAt: now, updatedAt: now })
          .where(
            and(
              eq(productAlerts.id, candidate.alert.id),
              eq(productAlerts.status, 'ACTIVE'),
            ),
          )
          .returning({ id: productAlerts.id });
        if (!claimed) continue;
        const email = buildProductAlertEmail({
          conditionType: candidate.alert.conditionType as
            | 'PRICE_BELOW'
            | 'BACK_IN_STOCK',
          productTitle: candidate.productTitle,
          variantLabel: candidate.alert.variantId
            ? [candidate.variantColor, candidate.variantSize]
                .filter(Boolean)
                .join(' / ')
            : null,
          targetValue: candidate.alert.targetValue,
          currentPriceMinor,
        });
        await tx
          .insert(productAlertNotifications)
          .values({
            merchantId,
            alertId: candidate.alert.id,
            recipient: candidate.alert.deliveryEmail,
            subject: email.subject,
            body: email.text,
          })
          .onConflictDoNothing();
        triggered += 1;
      }
      return { evaluated: candidates.length, triggered };
    });
  }

  async claimPendingNotifications(merchantId: string, limit = 20) {
    return this.db.transaction(async (tx) => {
      await scopeWorker(tx, merchantId);
      const pending = await tx
        .select()
        .from(productAlertNotifications)
        .where(
          and(
            eq(productAlertNotifications.merchantId, merchantId),
            eq(productAlertNotifications.status, 'PENDING'),
          ),
        )
        .orderBy(asc(productAlertNotifications.createdAt))
        .limit(limit);
      const claimed: Array<typeof productAlertNotifications.$inferSelect> = [];
      for (const row of pending) {
        const [next] = await tx
          .update(productAlertNotifications)
          .set({ status: 'SENDING', attempts: row.attempts + 1 })
          .where(
            and(
              eq(productAlertNotifications.id, row.id),
              eq(productAlertNotifications.merchantId, merchantId),
              eq(productAlertNotifications.status, 'PENDING'),
            ),
          )
          .returning();
        if (next) claimed.push(next);
      }
      return claimed;
    });
  }

  async markNotificationSent(
    merchantId: string,
    notificationId: string,
    sentAt = new Date(),
  ) {
    return this.db.transaction(async (tx) => {
      await scopeWorker(tx, merchantId);
      await tx
        .update(productAlertNotifications)
        .set({ status: 'SENT', sentAt, lastError: null })
        .where(
          and(
            eq(productAlertNotifications.id, notificationId),
            eq(productAlertNotifications.merchantId, merchantId),
          ),
        );
    });
  }

  async retryNotification(
    merchantId: string,
    notificationId: string,
    error: string,
  ) {
    return this.db.transaction(async (tx) => {
      await scopeWorker(tx, merchantId);
      await tx
        .update(productAlertNotifications)
        .set({ status: 'PENDING', lastError: error.slice(0, 1000) })
        .where(
          and(
            eq(productAlertNotifications.id, notificationId),
            eq(productAlertNotifications.merchantId, merchantId),
          ),
        );
    });
  }

  private async requirePublicTarget(
    tx: Tx,
    input: CreateProductAlertRequest,
  ): Promise<string> {
    const [product] = await tx
      .select({ id: products.id, merchantId: products.merchantId })
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
      throw Object.assign(new Error('Alert ürünü bulunamadı.'), {
        statusCode: 404,
        code: 'PRODUCT_NOT_FOUND',
      });
    if (input.variantId) {
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
    return product.merchantId;
  }
}
