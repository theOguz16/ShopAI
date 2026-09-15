import type { Surface, Transport } from '@shopai/contracts';
import { inArray, sql } from 'drizzle-orm';
import type { Database } from './client.js';
import { merchants, searchEvents } from './schema.js';

export type SearchEventInput = {
  merchantId: string;
  searchId?: string;
  discoverySessionId?: string;
  transport: Transport;
  surface: Surface;
  requestKind: 'initial' | 'pagination';
  outcome: 'results' | 'empty' | 'error';
};

export class PostgresSearchEventRepository {
  constructor(private readonly db: Database) {}

  async record(events: SearchEventInput[]) {
    if (!events.length) return;
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`set local role shopai_public`);
      const merchantIds = [...new Set(events.map((event) => event.merchantId))];
      const visibleMerchants = await tx
        .select({ id: merchants.id })
        .from(merchants)
        .where(inArray(merchants.id, merchantIds));
      const visibleIds = new Set(
        visibleMerchants.map((merchant) => merchant.id),
      );
      const visibleEvents = events.filter((event) =>
        visibleIds.has(event.merchantId),
      );
      if (!visibleEvents.length) return;
      await tx.insert(searchEvents).values(visibleEvents);
    });
  }
}
