import type { DiscoverySessionRepository } from '@shopai/commerce/discovery';
import { and, eq, or, sql } from 'drizzle-orm';
import type { Database } from './client.js';
import { discoverySessions, merchants } from './schema.js';

export class PostgresDiscoverySessionRepository
  implements DiscoverySessionRepository
{
  constructor(private readonly db: Database) {}

  async resolveActiveMerchant(value: string) {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`set local role shopai_public`);
      const [row] = await tx
        .select({ id: merchants.id })
        .from(merchants)
        .where(
          and(
            eq(merchants.active, true),
            or(eq(merchants.id, value), eq(merchants.slug, value)),
          ),
        )
        .limit(1);
      return row ?? null;
    });
  }

  async create(input: Parameters<DiscoverySessionRepository['create']>[0]) {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`set local role shopai_public`);
      const [row] = await tx
        .insert(discoverySessions)
        .values(input)
        .returning();
      if (!row) throw new Error('Discovery session oluşturulamadı.');
      return {
        ...row,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      };
    });
  }

  async findById(id: string) {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`set local role shopai_public`);
      const [row] = await tx
        .select()
        .from(discoverySessions)
        .where(eq(discoverySessions.id, id))
        .limit(1);
      return row
        ? {
            ...row,
            createdAt: row.createdAt.toISOString(),
            updatedAt: row.updatedAt.toISOString(),
          }
        : null;
    });
  }
}
