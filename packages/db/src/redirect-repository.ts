import { randomUUID } from 'node:crypto';
import type { RedirectRepository } from '@shopai/commerce';
import { and, eq, sql } from 'drizzle-orm';
import type { Database } from './client.js';
import {
  discoverySessions,
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
        .select({
          url: offers.checkoutUrl,
          merchantId: offers.merchantId,
          productId: products.id,
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
            eq(products.published, true),
          ),
        )
        .innerJoin(
          merchants,
          and(
            eq(merchants.id, offers.merchantId),
            eq(merchants.active, true),
            eq(merchants.isPublic, true),
          ),
        )
        .where(and(eq(offers.id, offerId), eq(offers.active, true)))
        .limit(1);
      return row ?? null;
    });
  }

  async recordClick(input: Parameters<RedirectRepository['recordClick']>[0]) {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`set local role shopai_public`);
      const attributionResult = await tx.execute(
        sql`
          select shopai_discovery_session_for_search(
            ${input.claims.searchId},
            ${input.merchantId}
          ) as "discoverySessionId"
        `,
      );
      const attribution = attributionResult.rows[0] as
        | { discoverySessionId: string | null }
        | undefined;
      const discoverySessionId = attribution?.discoverySessionId ?? null;
      const [session] = discoverySessionId
        ? await tx
            .select({ campaign: discoverySessions.campaign })
            .from(discoverySessions)
            .where(eq(discoverySessions.id, discoverySessionId))
            .limit(1)
        : [];
      const clickId = randomUUID();
      await tx.insert(redirectClicks).values({
        id: clickId,
        searchId: input.claims.searchId,
        discoverySessionId,
        offerId: input.claims.offerId,
        productId: input.productId,
        merchantId: input.merchantId,
        transport: input.claims.transport,
        surface: input.claims.surface,
        campaign: session?.campaign ?? null,
        classification: input.classification,
      });
      return clickId;
    });
  }
}
