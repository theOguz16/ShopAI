import type { AnonymousShoppingProfileRepository } from '@shopai/commerce/anonymous-shopping-profile';
import { anonymousShoppingProfileSchema } from '@shopai/contracts/anonymous-shopping-profile';
import { eq, sql } from 'drizzle-orm';
import { check, jsonb, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { Database } from './client.js';

const at = (name: string) =>
  timestamp(name, { withTimezone: true, mode: 'date' });

type PreferenceMap = Record<string, string[]>;
type PriceRangeMap = Record<
  string,
  {
    minPriceMinor?: number;
    maxPriceMinor?: number;
    currency: 'TRY';
  }
>;

export const anonymousShoppingProfiles = pgTable(
  'anonymous_shopping_profiles',
  {
    anonymousUserId: uuid('anonymous_user_id').primaryKey(),
    preferredSizes: jsonb('preferred_sizes')
      .$type<PreferenceMap>()
      .notNull()
      .default({}),
    preferredColors: jsonb('preferred_colors')
      .$type<PreferenceMap>()
      .notNull()
      .default({}),
    preferredStyles: jsonb('preferred_styles')
      .$type<PreferenceMap>()
      .notNull()
      .default({}),
    preferredPriceRanges: jsonb('preferred_price_ranges')
      .$type<PriceRangeMap>()
      .notNull()
      .default({}),
    createdAt: at('created_at').notNull().defaultNow(),
    updatedAt: at('updated_at').notNull().defaultNow(),
  },
  (t) => [
    check(
      'anonymous_profile_preferred_sizes_object',
      sql`jsonb_typeof(${t.preferredSizes}) = 'object'`,
    ),
    check(
      'anonymous_profile_preferred_colors_object',
      sql`jsonb_typeof(${t.preferredColors}) = 'object'`,
    ),
    check(
      'anonymous_profile_preferred_styles_object',
      sql`jsonb_typeof(${t.preferredStyles}) = 'object'`,
    ),
    check(
      'anonymous_profile_preferred_price_ranges_object',
      sql`jsonb_typeof(${t.preferredPriceRanges}) = 'object'`,
    ),
  ],
);

export class PostgresAnonymousShoppingProfileRepository
  implements AnonymousShoppingProfileRepository
{
  constructor(private readonly db: Database) {}

  async getOrCreate(anonymousUserId: string) {
    return this.db.transaction(async (tx) => {
      await this.scope(tx, anonymousUserId);
      await tx
        .insert(anonymousShoppingProfiles)
        .values({ anonymousUserId })
        .onConflictDoNothing();
      const [row] = await tx
        .select()
        .from(anonymousShoppingProfiles)
        .where(eq(anonymousShoppingProfiles.anonymousUserId, anonymousUserId))
        .limit(1);
      if (!row) throw new Error('Anonymous shopping profile oluşturulamadı.');
      return this.toContract(row);
    });
  }

  async replace(
    profile: Parameters<AnonymousShoppingProfileRepository['replace']>[0],
  ) {
    return this.db.transaction(async (tx) => {
      await this.scope(tx, profile.anonymousUserId);
      const [row] = await tx
        .update(anonymousShoppingProfiles)
        .set({
          preferredSizes: profile.preferredSizes,
          preferredColors: profile.preferredColors,
          preferredStyles: profile.preferredStyles,
          preferredPriceRanges: profile.preferredPriceRanges,
          updatedAt: new Date(),
        })
        .where(
          eq(
            anonymousShoppingProfiles.anonymousUserId,
            profile.anonymousUserId,
          ),
        )
        .returning();
      if (!row) throw new Error('Anonymous shopping profile güncellenemedi.');
      return this.toContract(row);
    });
  }

  private async scope(
    tx: Parameters<Parameters<Database['transaction']>[0]>[0],
    anonymousUserId: string,
  ) {
    await tx.execute(sql`set local role shopai_public`);
    await tx.execute(
      sql`select set_config('app.anonymous_user_id', ${anonymousUserId}, true)`,
    );
  }

  private toContract(row: typeof anonymousShoppingProfiles.$inferSelect) {
    return anonymousShoppingProfileSchema.parse({
      ...row,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    });
  }
}
