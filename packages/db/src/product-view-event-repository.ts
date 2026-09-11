import type {
  ProductViewEventInput,
  ProductViewEventRepository,
} from '@shopai/commerce/product-views';
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import type { Database } from './client.js';
import { discoverySessions, products } from './schema.js';

export const productViewEvents = pgTable(
  'product_view_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    merchantId: uuid('merchant_id').notNull(),
    productId: uuid('product_id').notNull(),
    searchId: uuid('search_id').notNull(),
    discoverySessionId: uuid('discovery_session_id').references(
      () => discoverySessions.id,
    ),
    transport: text('transport').notNull(),
    surface: text('surface').notNull(),
    occurredAt: timestamp('occurred_at', {
      withTimezone: true,
      mode: 'date',
    })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.merchantId, t.productId],
      foreignColumns: [products.merchantId, products.id],
    }),
    check(
      'product_view_event_transport',
      sql`${t.transport} in ('rest','mcp','ucp')`,
    ),
    check(
      'product_view_event_surface',
      sql`${t.surface} in ('web','chatgpt','gemini','brand_widget')`,
    ),
    index('product_view_events_reporting').on(t.merchantId, t.occurredAt),
    index('product_view_events_surface_reporting').on(
      t.merchantId,
      t.surface,
      t.occurredAt,
    ),
    index('product_view_events_discovery_session').on(
      t.discoverySessionId,
      t.occurredAt,
    ),
  ],
);

export class PostgresProductViewEventRepository
  implements ProductViewEventRepository
{
  constructor(private readonly db: Database) {}

  async record(input: ProductViewEventInput) {
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`set local role shopai_public`);
      await tx.insert(productViewEvents).values({
        merchantId: input.merchantId,
        productId: input.productId,
        searchId: input.searchId,
        discoverySessionId: input.discoverySessionId ?? null,
        transport: input.transport,
        surface: input.surface,
      });
    });
  }
}
