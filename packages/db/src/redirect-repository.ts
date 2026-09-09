import type { RedirectRepository } from '@shopai/commerce';
import { and, eq, sql } from 'drizzle-orm';
import type { Database } from './client.js';
import {
  merchants,
  offers,
  products,
  redirectClicks,
  searchEvents,
  variants,
} from './schema.js';

export class PostgresRedirectRepository implements RedirectRepository {
  constructor(private readonly db: Database) {}

  async resolvePublishedOffer(offerId: string) {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`set local role shopai_public`);
      const [row] = await tx
        .select({ url: offers.checkoutUrl, merchantId: offers.merchantId })
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
            eq(products.published, true),
          ),
        )
        .innerJoin(
          merchants,
          and(eq(merchants.id, offers.merchantId), eq(merchants.active, true)),
        )
        .where(and(eq(offers.id, offerId), eq(offers.active, true)))
        .limit(1);
      return row ?? null;
    });
  }

  async recordClick(input: Parameters<RedirectRepository['recordClick']>[0]) {
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`set local role shopai_public`);
      const [searchEvent] = await tx
        .select({ discoverySessionId: searchEvents.discoverySessionId })
        .from(searchEvents)
        .where(
          and(
            eq(searchEvents.searchId, input.claims.searchId),
            eq(searchEvents.merchantId, input.merchantId),
          ),
        )
        .limit(1);
      await tx.insert(redirectClicks).values({
        searchId: input.claims.searchId,
        discoverySessionId: searchEvent?.discoverySessionId ?? null,
        offerId: input.claims.offerId,
        merchantId: input.merchantId,
        transport: input.claims.transport,
        surface: input.claims.surface,
        classification: input.classification,
      });
    });
  }
}
