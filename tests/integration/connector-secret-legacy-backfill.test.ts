import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createDatabase } from '../../packages/db/src/client.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL gerekli.');
const database = createDatabase(databaseUrl);
const backfill = readFileSync(
  new URL(
    '../../packages/db/drizzle/0037_connector_secret_legacy_backfill.sql',
    import.meta.url,
  ),
  'utf8',
);

afterAll(async () => database.close());

describe('0037 legacy scoped-file backfill', () => {
  it('backfills the missing historical file row without version collisions and stays idempotent', async () => {
    await database.db.transaction(async (tx) => {
      await tx.execute(sql`create schema urun004_backfill_test`);
      await tx.execute(sql`set local search_path to urun004_backfill_test`);
      await tx.execute(sql`
        create table source_connections (
          id uuid primary key,
          merchant_id uuid not null,
          provider text not null,
          credentials_ref text,
          active boolean not null default true,
          authorization_status text not null default 'pending',
          unique (merchant_id, id)
        )
      `);
      await tx.execute(sql`
        create table connector_secrets (
          id uuid primary key default gen_random_uuid(),
          merchant_id uuid not null,
          connection_id uuid not null,
          provider text not null,
          reference text not null unique,
          version bigint not null,
          status text not null,
          backend text not null default 'file',
          rotated_at timestamptz,
          constraint connector_secrets_connection_id_version_unique unique (connection_id, version),
          foreign key (merchant_id, connection_id)
            references source_connections (merchant_id, id)
        )
      `);
      const merchantA = 'a0000000-0000-4000-8000-00000000000a';
      const merchantB = 'b0000000-0000-4000-8000-00000000000b';
      const legacyConn = 'c0000000-0000-4000-8000-0000000000c1';
      const revokedConn = 'c0000000-0000-4000-8000-0000000000c2';
      await tx.execute(sql`
        insert into source_connections (id, merchant_id, provider, credentials_ref, active, authorization_status)
        values
          (${legacyConn}, ${merchantA}, 'woocommerce', 'secret://ONBOARDING_TEST0000000000000000000001', true, 'active'),
          (${revokedConn}, ${merchantA}, 'woocommerce', 'secret://ONBOARDING_TEST0000000000000000000002', false, 'revoked'),
          ('c0000000-0000-4000-8000-0000000000c3', ${merchantB}, 'woocommerce', null, true, 'pending')
      `);

      for (const statement of backfill.split('--> statement-breakpoint')) {
        if (statement.trim()) await tx.execute(sql.raw(statement));
      }

      const backfilled = await tx.execute(sql`
        select merchant_id, connection_id, provider, reference, version, status, backend
        from connector_secrets order by reference
      `);
      expect(backfilled.rows).toEqual([
        {
          merchant_id: merchantA,
          connection_id: legacyConn,
          provider: 'woocommerce',
          reference: 'secret://ONBOARDING_TEST0000000000000000000001',
          version: '1',
          status: 'active',
          backend: 'file',
        },
        {
          merchant_id: merchantA,
          connection_id: revokedConn,
          provider: 'woocommerce',
          reference: 'secret://ONBOARDING_TEST0000000000000000000002',
          version: '1',
          status: 'active',
          backend: 'file',
        },
      ]);
      const revokedState = await tx.execute(sql`
        select active, authorization_status from source_connections where id = ${revokedConn}
      `);
      expect(revokedState.rows).toEqual([
        { active: false, authorization_status: 'revoked' },
      ]);

      for (const statement of backfill.split('--> statement-breakpoint')) {
        if (statement.trim()) await tx.execute(sql.raw(statement));
      }
      const afterRerun = await tx.execute(
        sql`select count(*)::int as count from connector_secrets`,
      );
      expect(afterRerun.rows).toEqual([{ count: 2 }]);

      await tx.execute(sql`
        update connector_secrets
        set status = 'rotated', rotated_at = now()
        where connection_id = ${legacyConn} and version = 1
      `);
      await tx.execute(sql`
        insert into connector_secrets
          (merchant_id, connection_id, provider, reference, version, status, backend)
        values
          (${merchantA}, ${legacyConn}, 'woocommerce',
           'secret://ONBOARDING_TEST0000000000000000000009', 2, 'active', 'openbao')
      `);
      const rollbackTarget = await tx.execute(sql`
        select reference from connector_secrets
        where connection_id = ${legacyConn}
          and backend = 'file' and status = 'rotated' and version = 1
      `);
      expect(rollbackTarget.rows).toEqual([
        { reference: 'secret://ONBOARDING_TEST0000000000000000000001' },
      ]);
      await tx.execute(sql`savepoint collision_test`);
      const collision = await tx
        .execute(sql`
          insert into connector_secrets
            (merchant_id, connection_id, provider, reference, version, status, backend)
          values
            (${merchantA}, ${legacyConn}, 'woocommerce',
             'secret://ONBOARDING_TEST0000000000000000000008', 1, 'rotated', 'openbao')
        `)
        .then(
          () => null,
          (error: unknown) => error,
        );
      await tx.execute(sql`rollback to savepoint collision_test`);
      expect(
        String((collision as { cause?: Error })?.cause ?? collision),
      ).toContain('connector_secrets_connection_id_version_unique');
      await tx.execute(sql`drop schema urun004_backfill_test cascade`);
    });
  });
});
