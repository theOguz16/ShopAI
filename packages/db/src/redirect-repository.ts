import type { RedirectRepository } from '@shopai/commerce';
import { and, eq, sql } from 'drizzle-orm';
import type { Database } from './client.js';
import {
  merchants,
  offers,
  products,
  redirectClicks,
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
      await tx.insert(redirectClicks).values({
        searchId: input.claims.searchId,
        discoverySessionId: input.claims.discoverySessionId,
        offerId: input.claims.offerId,
        merchantId: input.merchantId,
        transport: input.claims.transport,
        surface: input.claims.surface,
        classification: input.classification,
      });
    });
  }
}
