import { ManagedConnectorSecretStore } from '../packages/connectors/src/managed-secrets.js';
import { connectorOnboardingCredentialsSchema } from '../packages/contracts/src/index.js';
import { EnvironmentSecretResolver } from '../apps/worker/src/sync.js';
import {
  connections,
  connectorSecrets,
  connectorSecretAudit,
  createDatabase,
  merchantCredentialOwnerships,
  withTenant,
} from '../packages/db/src/index.js';
import { and, eq, sql } from 'drizzle-orm';

// Opt-in staging/local migration. It never deletes the old encrypted/plaintext
// record; operators remove it only after backup and rollback windows close.
const apply = process.argv.includes('--apply');
if (!['local', 'staging'].includes(process.env.DEPLOY_ENV ?? 'local'))
  throw new Error('Migration yalnız local/staging ortamında çalışır.');
if (!process.env.DATABASE_URL || !process.env.CONNECTOR_SECRET_ENCRYPTION_KEY)
  throw new Error('DB ve connector encryption key gerekli.');
const root = process.env.UPLOAD_DIR ?? 'private/uploads';
const database = createDatabase(process.env.DATABASE_URL, {
  applicationName: 'shopai-secret-migration',
});
const store = new ManagedConnectorSecretStore(
  root,
  process.env.CONNECTOR_SECRET_ENCRYPTION_KEY,
);
const legacy = new EnvironmentSecretResolver(process.env);
try {
  const candidates = await database.db
    .select({
      id: connections.id,
      merchantId: connections.merchantId,
      provider: connections.provider,
      reference: connections.credentialsRef,
    })
    .from(connections)
    .where(eq(connections.active, true));
  let pending = 0;
  let migrated = 0;
  for (const row of candidates) {
    if (!row.reference || !['woocommerce', 'trendyol'].includes(row.provider))
      continue;
    const [existing] = await database.db
      .select({ id: connectorSecrets.id })
      .from(connectorSecrets)
      .where(
        and(
          eq(connectorSecrets.connectionId, row.id),
          eq(connectorSecrets.reference, row.reference),
        ),
      )
      .limit(1);
    if (existing) continue;
    pending++;
    if (!apply) continue;
    const scope = {
      merchantId: row.merchantId,
      connectionId: row.id,
      provider: row.provider,
    };
    const credentials = await legacy.resolve(row.reference);
    const reference = await store.createScoped(credentials, scope);
    try {
      const verified = await store.resolveScoped(reference, scope);
      if (
        JSON.stringify(verified) !==
        JSON.stringify(connectorOnboardingCredentialsSchema.parse(credentials))
      )
        throw new Error('Migration verification failed.');
      const changed = await withTenant(
        database.db,
        row.merchantId,
        async (tx) => {
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtext(${row.id}))`,
          );
          const [current] = await tx
            .select({
              reference: connections.credentialsRef,
              active: connections.active,
            })
            .from(connections)
            .where(
              and(
                eq(connections.id, row.id),
                eq(connections.merchantId, row.merchantId),
              ),
            )
            .limit(1);
          if (!current?.active || current.reference !== row.reference)
            return false;
          await tx
            .insert(connectorSecrets)
            .values({ ...scope, reference, version: 1, status: 'active' });
          await tx.insert(merchantCredentialOwnerships).values({
            merchantId: row.merchantId,
            provider: row.provider,
            credentialsRef: reference,
          });
          await tx
            .update(connections)
            .set({ credentialsRef: reference })
            .where(
              and(
                eq(connections.id, row.id),
                eq(connections.merchantId, row.merchantId),
              ),
            );
          await tx.insert(connectorSecretAudit).values({
            merchantId: row.merchantId,
            connectionId: row.id,
            reference,
            event: 'created',
            actor: 'migration',
          });
          return true;
        },
      );
      if (!changed) await store.remove(reference);
      else migrated++;
    } catch {
      await store.remove(reference).catch(() => undefined);
      throw new Error(
        'Secret migration failed; old connection remains active.',
      );
    }
  }
  console.info(
    JSON.stringify({ mode: apply ? 'apply' : 'plan', pending, migrated }),
  );
} finally {
  await database.close();
}
