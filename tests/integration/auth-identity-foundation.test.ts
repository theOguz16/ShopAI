import { randomUUID } from 'node:crypto';
import { eq, inArray, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createDatabase } from '../../packages/db/src/client.js';
import {
  authAuditEvents,
  oidcAuthTransactions,
  userIdentities,
} from '../../packages/db/src/auth-schema.js';
import { users } from '../../packages/db/src/schema.js';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  describe.skip('ÜRÜN-003 identity foundation integration', () => {
    it('requires a migrated PostgreSQL database', () => undefined);
  });
} else {
  describe('ÜRÜN-003 identity foundation integration', () => {
    it('preserves pilot UUIDs and rejects duplicate issuer + subject', async () => {
      const database = createDatabase(databaseUrl);
      const suffix = randomUUID().replaceAll('-', '');
      const pilotEmail = `urun003-pilot-${suffix}@example.invalid`;
      const anotherEmail = `urun003-other-${suffix}@example.invalid`;
      const issuer = 'https://tenant.example.auth0.com/';
      const subject = `auth0|${suffix}`;
      const ids: string[] = [];
      const stateHash = randomUUID().replaceAll('-', '');
      try {
        const [pilot] = await database.db
          .insert(users)
          .values({ email: pilotEmail })
          .returning();
        const [other] = await database.db
          .insert(users)
          .values({ email: anotherEmail })
          .returning();
        expect(pilot).toBeDefined();
        expect(other).toBeDefined();
        if (!pilot || !other) throw new Error('test setup failed');
        ids.push(pilot.id, other.id);

        const before = await database.db.execute(sql`
          select id, account_status, email_verified_at
          from users where id = ${pilot.id}::uuid
        `);
        expect(before.rows[0]).toMatchObject({
          id: pilot.id,
          account_status: 'pilot',
          email_verified_at: null,
        });

        await database.db.insert(userIdentities).values({
          userId: pilot.id,
          issuer,
          subject,
        });
        await expect(
          database.db.insert(userIdentities).values({
            userId: other.id,
            issuer,
            subject,
          }),
        ).rejects.toThrow();

        const linked = await database.db
          .select({ userId: userIdentities.userId })
          .from(userIdentities)
          .where(eq(userIdentities.subject, subject));
        expect(linked).toEqual([{ userId: pilot.id }]);
        const after = await database.db.execute(sql`
          select id, account_status from users where id = ${pilot.id}::uuid
        `);
        expect(after.rows[0]).toMatchObject({
          id: pilot.id,
          account_status: 'pilot',
        });

        await database.db.insert(oidcAuthTransactions).values({
          stateHash,
          browserBindingHash: `binding-${suffix}`,
          clientKind: 'merchant',
          nonceHash: `nonce-${suffix}`,
          pkceVerifierCiphertext: 'encrypted-test-fixture-not-a-real-verifier',
          returnTo: '/dashboard',
          expiresAt: new Date(Date.now() + 60_000),
        });
        await database.db.insert(authAuditEvents).values({
          userId: pilot.id,
          eventType: 'identity_link',
          outcome: 'success',
          requestId: `test-${suffix}`,
        });
        const rights = await database.db.execute(sql`
          select has_table_privilege('shopai_public',
            'user_identities', 'SELECT') as can_read
        `);
        expect(rights.rows[0]?.can_read).toBe(false);
      } finally {
        try {
          await database.db
            .delete(oidcAuthTransactions)
            .where(eq(oidcAuthTransactions.stateHash, stateHash));
          await database.db
            .delete(authAuditEvents)
            .where(eq(authAuditEvents.requestId, `test-${suffix}`));
          await database.db
            .delete(userIdentities)
            .where(eq(userIdentities.subject, subject));
          if (ids.length)
            await database.db.delete(users).where(inArray(users.id, ids));
        } finally {
          await database.close();
        }
      }
    });
  });
}
