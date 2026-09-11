import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { productAttributes } from '../../packages/db/src/category-model.js';
import { createDatabase } from '../../packages/db/src/client.js';
import {
  connections,
  importOutboxEvents,
  importRuns,
  merchants,
  products,
} from '../../packages/db/src/schema.js';
import { setTenantContext } from '../../packages/db/src/tenant-context.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('tenant-isolation.test için DATABASE_URL gerekli.');
const adminDatabase = createDatabase(url, {
  applicationName: 'shopai-tenant-fixtures',
});
const applicationDatabase = createDatabase(url, {
  applicationName: 'shopai-tenant-application',
});
const tenantA = 'a1000000-0000-4000-8000-000000000001';
const tenantB = 'b1000000-0000-4000-8000-000000000001';
const productA = 'a1000000-0000-4000-8000-000000000004';
const productB = 'b1000000-0000-4000-8000-000000000004';

beforeAll(async () => {
  await adminDatabase.db.execute(
    sql`truncate table ${importOutboxEvents}, ${importRuns}, ${productAttributes}, ${products}, ${connections}, ${merchants} cascade`,
  );
  await adminDatabase.db.insert(merchants).values([
    {
      id: tenantA,
      name: 'Tenant A',
      slug: 'tenant-a',
      active: true,
      isPublic: true,
    },
    {
      id: tenantB,
      name: 'Tenant B',
      slug: 'tenant-b',
      active: true,
      isPublic: false,
    },
  ]);
  await adminDatabase.db.insert(connections).values([
    {
      id: 'a1000000-0000-4000-8000-000000000002',
      merchantId: tenantA,
      provider: 'test',
    },
    {
      id: 'b1000000-0000-4000-8000-000000000002',
      merchantId: tenantB,
      provider: 'test',
    },
  ]);
  await adminDatabase.db
    .insert(products)
    .values([
      {
        id: productA,
        merchantId: tenantA,
        connectionId: 'a1000000-0000-4000-8000-000000000002',
        externalKey: 'a-product',
        title: 'A özel',
        category: 'test',
        published: true,
        observedAt: new Date(),
      },
      {
        id: productB,
        merchantId: tenantB,
        connectionId: 'b1000000-0000-4000-8000-000000000002',
        externalKey: 'b-product',
        title: 'B özel',
        category: 'test',
        published: true,
        observedAt: new Date(),
      },
    ])
    .onConflictDoNothing();
  await adminDatabase.db.insert(productAttributes).values([
    {
      merchantId: tenantA,
      productId: productA,
      key: 'size',
      value: 'M',
    },
    {
      merchantId: tenantB,
      productId: productB,
      key: 'size',
      value: 'L',
    },
  ]);
  await adminDatabase.db.insert(importRuns).values([
    {
      id: 'a1000000-0000-4000-8000-000000000003',
      merchantId: tenantA,
      connectionId: 'a1000000-0000-4000-8000-000000000002',
      rows: 0,
      observedAt: new Date(),
      status: 'pending',
      filePath: '/private/a.csv',
    },
    {
      id: 'b1000000-0000-4000-8000-000000000003',
      merchantId: tenantB,
      connectionId: 'b1000000-0000-4000-8000-000000000002',
      rows: 0,
      observedAt: new Date(),
      status: 'pending',
      filePath: '/private/b.csv',
    },
  ]);
  await adminDatabase.db.insert(importOutboxEvents).values([
    {
      runId: 'a1000000-0000-4000-8000-000000000003',
      merchantId: tenantA,
      payload: { tenant: 'a' },
    },
    {
      runId: 'b1000000-0000-4000-8000-000000000003',
      merchantId: tenantB,
      payload: { tenant: 'b' },
    },
  ]);
});

afterAll(async () => {
  await applicationDatabase.close();
  await adminDatabase.close();
});

describe('database tenant isolation', () => {
  it('prevents cross-tenant reads on a reused pooled connection', async () => {
    const readAs = async (tenantId: string) =>
      applicationDatabase.db.transaction(async (tx) => {
        await tx.execute(sql`set local role shopai_app`);
        await setTenantContext(tx, tenantId);
        const visibleMerchants = await tx
          .select({ id: merchants.id })
          .from(merchants);
        const visibleProducts = await tx
          .select({ key: products.externalKey })
          .from(products)
          .where(eq(products.category, 'test'));
        return { visibleMerchants, visibleProducts };
      });
    await expect(readAs(tenantA)).resolves.toEqual({
      visibleMerchants: [{ id: tenantA }],
      visibleProducts: [{ key: 'a-product' }],
    });
    await expect(readAs(tenantB)).resolves.toEqual({
      visibleMerchants: [{ id: tenantB }],
      visibleProducts: [{ key: 'b-product' }],
    });
  });

  it('returns no tenant rows when context is absent', async () => {
    await expect(
      applicationDatabase.db.transaction(async (tx) => {
        await tx.execute(sql`set local role shopai_app`);
        return tx.select().from(products);
      }),
    ).resolves.toEqual([]);
  });

  it('hides private merchant product attributes from the public role', async () => {
    const visibility = await applicationDatabase.db.transaction(async (tx) => {
      await tx.execute(sql`set local role shopai_public`);
      const publicRows = await tx
        .select({ value: productAttributes.value })
        .from(productAttributes)
        .where(eq(productAttributes.merchantId, tenantA));
      const privateRows = await tx
        .select({ value: productAttributes.value })
        .from(productAttributes)
        .where(eq(productAttributes.merchantId, tenantB));
      return { publicRows, privateRows };
    });

    expect(visibility.publicRows).toEqual([{ value: 'M' }]);
    expect(visibility.privateRows).toEqual([]);
  });

  it('isolates application outbox access and reserves global access for the worker', async () => {
    await applicationDatabase.db.transaction(async (tx) => {
      await setTenantContext(tx, tenantA);
      await expect(
        tx
          .select({ merchantId: importOutboxEvents.merchantId })
          .from(importOutboxEvents),
      ).resolves.toEqual([{ merchantId: tenantA }]);
      await expect(
        tx
          .update(importOutboxEvents)
          .set({ attempts: 99 })
          .where(eq(importOutboxEvents.merchantId, tenantB))
          .returning({ id: importOutboxEvents.id }),
      ).resolves.toEqual([]);
    });
    await expect(
      applicationDatabase.db.transaction(async (tx) => {
        await setTenantContext(tx, tenantA);
        return tx.insert(importOutboxEvents).values({
          runId: 'b1000000-0000-4000-8000-000000000003',
          merchantId: tenantB,
          payload: { forged: true },
        });
      }),
    ).rejects.toThrow();
    await applicationDatabase.db.transaction(async (tx) => {
      await setTenantContext(tx, tenantB);
      await expect(
        tx
          .select({ payload: importOutboxEvents.payload })
          .from(importOutboxEvents),
      ).resolves.toEqual([{ payload: { tenant: 'b' } }]);
    });
    await applicationDatabase.db.transaction(async (tx) => {
      await tx.execute(sql`set local role shopai_worker`);
      await expect(
        tx
          .select({ merchantId: importOutboxEvents.merchantId })
          .from(importOutboxEvents),
      ).resolves.toEqual(
        expect.arrayContaining([
          { merchantId: tenantA },
          { merchantId: tenantB },
        ]),
      );
    });
  });
});
