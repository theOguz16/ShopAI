import { eq, sql } from 'drizzle-orm';
import type { Database } from './client.js';
import { merchants } from './schema.js';

export type TenantId = string;

export function requireTenantId(tenantId: string | undefined): TenantId {
  if (
    !tenantId ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      tenantId,
    )
  )
    throw new Error('Tenant kapsamı zorunludur.');
  return tenantId;
}

/** SET LOCAL is transaction-scoped and is reset before a pooled connection is reused. */
export async function setTenantContext(
  tx: Database | { execute(query: unknown): Promise<unknown> },
  tenantId: string,
) {
  const validTenantId = requireTenantId(tenantId);
  // Application and worker connections are deliberately restricted roles.
  // SET LOCAL is cleared when the pooled transaction ends.
  await tx.execute(sql`set local role shopai_app`);
  await tx.execute(
    sql`select set_config('app.tenant_id', ${validTenantId}, true)`,
  );
}

export async function withTenant<T>(
  db: Database,
  tenantId: string,
  // Drizzle does not export a stable cross-dialect transaction type.
  // biome-ignore lint/suspicious/noExplicitAny: transaction type is dialect-private
  operation: (tx: any) => Promise<T>,
) {
  requireTenantId(tenantId);
  return db.transaction(async (tx) => {
    await setTenantContext(tx, tenantId);
    return operation(tx);
  });
}

export async function withWorkerRole<T>(
  db: Database,
  // biome-ignore lint/suspicious/noExplicitAny: transaction type is dialect-private
  operation: (tx: any) => Promise<T>,
) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local role shopai_worker`);
    return operation(tx);
  });
}

export async function bootstrapMerchant(
  db: Database,
  input: { userId: string; merchantId: string; name: string; slug: string },
) {
  requireTenantId(input.userId);
  requireTenantId(input.merchantId);
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local role shopai_app`);
    await tx.execute(
      sql`select set_config('app.user_id', ${input.userId}, true)`,
    );
    await tx.execute(
      sql`select shopai_bootstrap_merchant(${input.merchantId}, ${input.name}, ${input.slug})`,
    );
    await tx.execute(
      sql`select set_config('app.tenant_id', ${input.merchantId}, true)`,
    );
    const [merchant] = await tx
      .select()
      .from(merchants)
      .where(eq(merchants.id, input.merchantId));
    return merchant;
  });
}
