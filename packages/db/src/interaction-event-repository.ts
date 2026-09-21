import type {
  InteractionEventsRequest,
  Surface,
  Transport,
} from '@shopai/contracts';
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { Database } from './client.js';
import { discoverySessions, merchants, products } from './schema.js';

export const interactionEvents = pgTable(
  'interaction_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventKey: uuid('event_key').notNull(),
    eventType: text('event_type').notNull(),
    merchantId: uuid('merchant_id')
      .notNull()
      .references(() => merchants.id),
    productId: uuid('product_id'),
    discoverySessionId: uuid('discovery_session_id')
      .notNull()
      .references(() => discoverySessions.id),
    transport: text('transport').notNull(),
    surface: text('surface').notNull(),
    category: text('category'),
    filterKind: text('filter_kind'),
    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('interaction_events_event_key_unique').on(t.eventKey),
    check(
      'interaction_event_type',
      sql`${t.eventType} in ('category_selected','filter_applied','product_impression','product_saved','alert_created')`,
    ),
    check(
      'interaction_event_transport',
      sql`${t.transport} in ('rest','mcp','ucp')`,
    ),
    check(
      'interaction_event_surface',
      sql`${t.surface} in ('web','chatgpt','gemini','brand_widget')`,
    ),
    index('interaction_events_merchant_type_time').on(
      t.merchantId,
      t.eventType,
      t.occurredAt,
    ),
    index('interaction_events_session_time').on(
      t.discoverySessionId,
      t.occurredAt,
    ),
  ],
);

export class PostgresInteractionEventRepository {
  constructor(private readonly db: Database) {}

  async record(
    request: InteractionEventsRequest,
    attribution: { transport: Transport; surface: Surface },
  ) {
    return this.db.transaction(async (tx) => {
      const productIds = request.events.flatMap((event) =>
        event.productId ? [event.productId] : [],
      );
      const productRows = productIds.length
        ? await tx
            .select({ id: products.id, merchantId: products.merchantId })
            .from(products)
            .where(inArray(products.id, productIds))
        : [];
      const productMerchants = new Map(
        productRows.map((row) => [row.id, row.merchantId]),
      );
      if (
        request.events.some(
          (event) =>
            event.productId &&
            productMerchants.get(event.productId) !== event.merchantId,
        )
      )
        throw Object.assign(
          new Error('Product merchant attribution uyuşmuyor.'),
          { statusCode: 400, code: 'INTERACTION_PRODUCT_MERCHANT_MISMATCH' },
        );

      await tx.execute(sql`set local role shopai_public`);
      await tx.execute(
        sql`select set_config('app.discovery_session_id', ${request.discoverySessionId}, true)`,
      );
      const [session] = await tx
        .select({ merchantScope: discoverySessions.merchantScope })
        .from(discoverySessions)
        .where(
          and(
            eq(discoverySessions.id, request.discoverySessionId),
            eq(discoverySessions.transport, attribution.transport),
            eq(discoverySessions.surface, attribution.surface),
          ),
        )
        .limit(1);
      if (!session)
        throw Object.assign(new Error('Discovery session bulunamadı.'), {
          statusCode: 400,
          code: 'DISCOVERY_SESSION_NOT_FOUND',
        });
      if (
        session.merchantScope.length &&
        request.events.some(
          (event) => !session.merchantScope.includes(event.merchantId),
        )
      )
        throw Object.assign(new Error('Interaction merchant scope dışı.'), {
          statusCode: 403,
          code: 'DISCOVERY_SESSION_SCOPE_MISMATCH',
        });

      const inserted = await tx
        .insert(interactionEvents)
        .values(
          request.events.map((event) => ({
            eventKey: event.eventKey,
            eventType: event.type,
            merchantId: event.merchantId,
            productId: event.productId ?? null,
            discoverySessionId: request.discoverySessionId,
            ...attribution,
            category: event.category ?? null,
            filterKind: event.filterKind ?? null,
          })),
        )
        .onConflictDoNothing()
        .returning({ id: interactionEvents.id });
      return {
        accepted: inserted.length,
        duplicates: request.events.length - inserted.length,
      };
    });
  }
}
