import {
  createConnectorSecretBackend,
  ManagedConnectorSecretStore,
} from '../packages/connectors/src/index.js';
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
import { and, desc, eq, lte, sql } from 'drizzle-orm';

const selectedActions = ['--cleanup', '--rollback', '--apply'].filter((flag) =>
  process.argv.includes(flag),
);
if (selectedActions.length > 1) throw new Error('Tek eylem seçin.');
const action = process.argv.includes('--cleanup')
  ? 'cleanup'
  : process.argv.includes('--rollback')
    ? 'rollback'
    : process.argv.includes('--apply')
      ? 'apply'
      : 'plan';
if (!['local', 'staging'].includes(process.env.DEPLOY_ENV ?? 'local'))
  throw new Error('Migration yalnız local/staging ortamında çalışır.');
if (!process.env.DATABASE_URL || !process.env.CONNECTOR_SECRET_ENCRYPTION_KEY)
  throw new Error('DB ve kaynak encryption key gerekli.');
const configuredBackend = process.env.CONNECTOR_SECRET_BACKEND ?? 'file';
if (configuredBackend !== 'file' && configuredBackend !== 'aws')
  throw new Error('Geçersiz connector secret backend.');
const targetBackend = configuredBackend;
const root = process.env.UPLOAD_DIR ?? 'private/uploads';
const database = createDatabase(process.env.DATABASE_URL, {
  applicationName: 'shopai-secret-migration',
});
const source = new ManagedConnectorSecretStore(
  root,
  process.env.CONNECTOR_SECRET_ENCRYPTION_KEY,
);
const legacy = new EnvironmentSecretResolver(process.env);
const target = createConnectorSecretBackend({
  backend: targetBackend,
  privateRoot: root,
  encryptionKey: process.env.CONNECTOR_SECRET_ENCRYPTION_KEY,
  region: process.env.CONNECTOR_SECRET_AWS_REGION,
  namespace: process.env.CONNECTOR_SECRET_AWS_NAMESPACE,
  healthSecretId: process.env.CONNECTOR_SECRET_AWS_HEALTH_SECRET_ID,
  kmsKeyId: process.env.CONNECTOR_SECRET_AWS_KMS_KEY_ID,
});

try {
  if (targetBackend === 'aws') await target.health();
  if (action === 'rollback') {
    if (targetBackend !== 'aws')
      throw new Error('Rollback AWS hedefi için desteklenir.');
    const rows = await database.db
      .select({
        id: connections.id,
        merchantId: connections.merchantId,
        provider: connections.provider,
        reference: connections.credentialsRef,
      })
      .from(connections)
      .where(eq(connections.active, true));
    let restored = 0;
    for (const row of rows) {
      if (!row.reference) continue;
      const [current] = await database.db
        .select({ id: connectorSecrets.id })
        .from(connectorSecrets)
        .where(
          and(
            eq(connectorSecrets.connectionId, row.id),
            eq(connectorSecrets.reference, row.reference),
            eq(connectorSecrets.backend, 'aws'),
            eq(connectorSecrets.status, 'active'),
          ),
        )
        .limit(1);
      if (!current) continue;
      const [migration] = await database.db
        .select({ id: connectorSecretAudit.id })
        .from(connectorSecretAudit)
        .where(
          and(
            eq(connectorSecretAudit.connectionId, row.id),
            eq(connectorSecretAudit.reference, row.reference),
            eq(connectorSecretAudit.actor, 'migration'),
            eq(connectorSecretAudit.event, 'created'),
          ),
        )
        .limit(1);
      if (!migration) continue;
      const [previous] = await database.db
        .select({
          id: connectorSecrets.id,
          reference: connectorSecrets.reference,
        })
        .from(connectorSecrets)
        .where(
          and(
            eq(connectorSecrets.connectionId, row.id),
            eq(connectorSecrets.backend, 'file'),
            eq(connectorSecrets.status, 'rotated'),
          ),
        )
        .orderBy(desc(connectorSecrets.version))
        .limit(1);
      if (!previous) continue;
      const scope = {
        merchantId: row.merchantId,
        connectionId: row.id,
        provider: row.provider,
      };
      await source.resolveScoped(previous.reference, scope);
      const changed = await withTenant(
        database.db,
        row.merchantId,
        async (tx) => {
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtext(${row.id}))`,
          );
          const [locked] = await tx
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
            .limit(1)
            .for('update');
          if (!locked?.active || locked.reference !== row.reference)
            return false;
          await tx
            .update(connectorSecrets)
            .set({ status: 'rotated', rotatedAt: new Date() })
            .where(eq(connectorSecrets.id, current.id));
          await tx
            .update(connectorSecrets)
            .set({ status: 'active', rotatedAt: null })
            .where(eq(connectorSecrets.id, previous.id));
          await tx
            .update(connections)
            .set({ credentialsRef: previous.reference })
            .where(
              and(
                eq(connections.id, row.id),
                eq(connections.merchantId, row.merchantId),
              ),
            );
          await tx.insert(connectorSecretAudit).values({
            merchantId: row.merchantId,
            connectionId: row.id,
            reference: row.reference!,
            event: 'rotated',
            actor: 'migration-rollback',
          });
          await tx.insert(connectorSecretAudit).values({
            merchantId: row.merchantId,
            connectionId: row.id,
            reference: previous.reference,
            event: 'created',
            actor: 'migration-rollback',
          });
          return true;
        },
      );
      if (changed) restored++;
    }
    console.info(JSON.stringify({ mode: action, restored }));
  } else if (action === 'cleanup') {
    if (targetBackend !== 'aws')
      throw new Error('Cleanup AWS hedefi için desteklenir.');
    if (!process.argv.includes('--confirm-retired-file-deletion'))
      throw new Error('Cleanup explicit confirmation gerektirir.');
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const retired = await database.db
      .select()
      .from(connectorSecretAudit)
      .where(
        and(
          eq(connectorSecretAudit.actor, 'migration'),
          eq(connectorSecretAudit.event, 'rotated'),
          lte(connectorSecretAudit.createdAt, cutoff),
        ),
      );
    let removed = 0;
    for (const old of retired) {
      if (!ManagedConnectorSecretStore.supports(old.reference)) continue;
      const active = await withTenant(
        database.db,
        old.merchantId,
        async (tx) => {
          const [row] = await tx
            .select({
              provider: connections.provider,
              reference: connections.credentialsRef,
            })
            .from(connections)
            .where(
              and(
                eq(connections.id, old.connectionId),
                eq(connections.merchantId, old.merchantId),
              ),
            )
            .limit(1);
          if (!row?.reference || row.reference === old.reference) return null;
          const [secret] = await tx
            .select({ backend: connectorSecrets.backend })
            .from(connectorSecrets)
            .where(
              and(
                eq(connectorSecrets.connectionId, old.connectionId),
                eq(connectorSecrets.reference, row.reference),
                eq(connectorSecrets.status, 'active'),
              ),
            )
            .limit(1);
          return secret?.backend === targetBackend ? row : null;
        },
      );
      if (!active?.reference) continue;
      await target.resolveScoped(active.reference, {
        merchantId: old.merchantId,
        connectionId: old.connectionId,
        provider: active.provider,
      });
      await source.remove(old.reference);
      removed++;
    }
    console.info(
      JSON.stringify({ mode: action, eligible: retired.length, removed }),
    );
  } else {
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
      const [ownership] = await database.db
        .select({ id: merchantCredentialOwnerships.id })
        .from(merchantCredentialOwnerships)
        .where(
          and(
            eq(merchantCredentialOwnerships.merchantId, row.merchantId),
            eq(merchantCredentialOwnerships.provider, row.provider),
            eq(merchantCredentialOwnerships.credentialsRef, row.reference),
          ),
        )
        .limit(1);
      if (!ownership) continue;
      const [existing] = await database.db
        .select({
          id: connectorSecrets.id,
          version: connectorSecrets.version,
          backend: connectorSecrets.backend,
        })
        .from(connectorSecrets)
        .where(
          and(
            eq(connectorSecrets.connectionId, row.id),
            eq(connectorSecrets.reference, row.reference),
            eq(connectorSecrets.status, 'active'),
          ),
        )
        .limit(1);
      if (existing?.backend === targetBackend) continue;
      if (existing?.backend === 'aws')
        throw new Error("AWS secret file backend'e taşınamaz.");
      pending++;
      if (action !== 'apply') continue;
      const scope = {
        merchantId: row.merchantId,
        connectionId: row.id,
        provider: row.provider,
      };
      const credentials = ManagedConnectorSecretStore.supports(row.reference)
        ? await source
            .resolveScoped(row.reference, scope)
            .catch(() => source.resolve(row.reference!))
        : await legacy.resolve(row.reference);
      const reference = await target.createScoped(credentials, scope);
      try {
        const verified = await target.resolveScoped(reference, scope);
        if (
          JSON.stringify(verified) !==
          JSON.stringify(
            connectorOnboardingCredentialsSchema.parse(credentials),
          )
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
              .limit(1)
              .for('update');
            if (!current?.active || current.reference !== row.reference)
              return false;
            if (existing)
              await tx
                .update(connectorSecrets)
                .set({ status: 'rotated', rotatedAt: new Date() })
                .where(eq(connectorSecrets.id, existing.id));
            await tx.insert(connectorSecrets).values({
              ...scope,
              reference,
              backend: targetBackend,
              version: existing ? existing.version + 1 : 1,
              status: 'active',
            });
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
              reference: row.reference!,
              event: 'rotated',
              actor: 'migration',
            });
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
        if (!changed) await target.remove(reference, scope);
        else migrated++;
      } catch {
        await target.remove(reference, scope).catch(() => undefined);
        throw new Error(
          'Secret migration failed; old connection remains active.',
        );
      }
    }
    console.info(
      JSON.stringify({ mode: action, targetBackend, pending, migrated }),
    );
  }
} finally {
  await database.close();
}
