import type { MerchantConversionRepository } from '@shopai/commerce/merchant-conversions';
import { surfaceSchema, transportSchema } from '@shopai/contracts';
import { and, eq } from 'drizzle-orm';
import type { Database } from './client.js';
import {
  connections,
  conversionOrders,
  offers,
  redirectClicks,
} from './schema.js';
import { setTenantContext } from './tenant-context.js';

export class PostgresMerchantConversionRepository
  implements MerchantConversionRepository
{
  constructor(private readonly db: Database) {}

  async recordPaidOrder(
    input: Parameters<MerchantConversionRepository['recordPaidOrder']>[0],
  ) {
    return this.db.transaction(async (tx) => {
      await setTenantContext(tx, input.merchantId);
      const [click] = await tx
        .select({
          clickId: redirectClicks.id,
          searchId: redirectClicks.searchId,
          discoverySessionId: redirectClicks.discoverySessionId,
          offerId: redirectClicks.offerId,
          transport: redirectClicks.transport,
          surface: redirectClicks.surface,
          connectionId: offers.connectionId,
          connectionActive: connections.active,
          conversionTrackingEnabled: connections.conversionTrackingEnabled,
        })
        .from(redirectClicks)
        .innerJoin(
          offers,
          and(
            eq(offers.id, redirectClicks.offerId),
            eq(offers.merchantId, redirectClicks.merchantId),
          ),
        )
        .innerJoin(
          connections,
          and(
            eq(connections.id, offers.connectionId),
            eq(connections.merchantId, offers.merchantId),
          ),
        )
        .where(
          and(
            eq(redirectClicks.id, input.clickId),
            eq(redirectClicks.merchantId, input.merchantId),
            eq(redirectClicks.classification, 'human'),
          ),
        )
        .limit(1);
      if (!click) return { status: 'click_not_found' as const };
      if (!click.connectionActive || !click.conversionTrackingEnabled)
        return { status: 'tracking_not_configured' as const };
      const transport = transportSchema.parse(click.transport);
      const surface = surfaceSchema.parse(click.surface);

      const values = {
        merchantId: input.merchantId,
        connectionId: click.connectionId,
        externalOrderId: input.orderId,
        status: 'paid' as const,
        currency: input.currency,
        grossMinor: input.orderValueMinor,
        refundedMinor: 0,
        clickId: click.clickId,
        searchId: click.searchId,
        discoverySessionId: click.discoverySessionId,
        offerId: click.offerId,
        transport,
        surface,
        occurredAt: new Date(),
      };
      const [created] = await tx
        .insert(conversionOrders)
        .values(values)
        .onConflictDoNothing()
        .returning({ id: conversionOrders.id });
      if (created)
        return {
          status: 'created' as const,
          conversionId: created.id,
          clickId: click.clickId,
          searchId: click.searchId,
          discoverySessionId: click.discoverySessionId,
          offerId: click.offerId,
          connectionId: click.connectionId,
          transport,
          surface,
        };

      const [existing] = await tx
        .select({
          id: conversionOrders.id,
          clickId: conversionOrders.clickId,
          searchId: conversionOrders.searchId,
          discoverySessionId: conversionOrders.discoverySessionId,
          offerId: conversionOrders.offerId,
          connectionId: conversionOrders.connectionId,
          transport: conversionOrders.transport,
          surface: conversionOrders.surface,
          status: conversionOrders.status,
          currency: conversionOrders.currency,
          grossMinor: conversionOrders.grossMinor,
        })
        .from(conversionOrders)
        .where(
          and(
            eq(conversionOrders.merchantId, input.merchantId),
            eq(conversionOrders.externalOrderId, input.orderId),
          ),
        )
        .limit(1);
      if (
        !existing ||
        existing.clickId !== input.clickId ||
        existing.status !== 'paid' ||
        existing.currency !== input.currency ||
        existing.grossMinor !== input.orderValueMinor ||
        !existing.searchId ||
        !existing.offerId ||
        !existing.transport ||
        !existing.surface
      )
        return { status: 'order_conflict' as const };
      const existingTransport = transportSchema.parse(existing.transport);
      const existingSurface = surfaceSchema.parse(existing.surface);

      return {
        status: 'duplicate' as const,
        conversionId: existing.id,
        clickId: existing.clickId,
        searchId: existing.searchId,
        discoverySessionId: existing.discoverySessionId,
        offerId: existing.offerId,
        connectionId: existing.connectionId,
        transport: existingTransport,
        surface: existingSurface,
      };
    });
  }
}
