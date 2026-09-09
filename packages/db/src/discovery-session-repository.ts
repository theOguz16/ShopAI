import type { DiscoverySessionRepository } from '@shopai/commerce/discovery';
import { discoverySessionSchema } from '@shopai/contracts';
import { and, eq, sql } from 'drizzle-orm';
import type { Database } from './client.js';
import { discoverySessions, merchants } from './schema.js';

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export class PostgresDiscoverySessionRepository
  implements DiscoverySessionRepository
{
  constructor(private readonly db: Database) {}

  async resolvePublicMerchant(value: string) {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`set local role shopai_public`);
      const identity = uuid.test(value)
        ? eq(merchants.id, value)
        : eq(merchants.slug, value);
      const [row] = await tx
        .select({ id: merchants.id })
        .from(merchants)
        .where(
          and(
            eq(merchants.active, true),
            eq(merchants.isPublic, true),
            identity,
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
      return discoverySessionSchema.parse({
        ...row,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      });
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
        ? discoverySessionSchema.parse({
            ...row,
            createdAt: row.createdAt.toISOString(),
            updatedAt: row.updatedAt.toISOString(),
          })
        : null;
    });
  }
}
