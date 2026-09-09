import { sql } from 'drizzle-orm';
import type { Database } from './client.js';
import { searchEvents } from './schema.js';

export type SearchEventInput = {
  merchantId: string;
  searchId?: string;
  channel: 'web' | 'mcp';
  requestKind: 'initial' | 'pagination';
  outcome: 'results' | 'empty' | 'error';
};

export class PostgresSearchEventRepository {
  constructor(private readonly db: Database) {}

  async record(events: SearchEventInput[]) {
    if (!events.length) return;
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`set local role shopai_public`);
      await tx.insert(searchEvents).values(events);
    });
  }
}
