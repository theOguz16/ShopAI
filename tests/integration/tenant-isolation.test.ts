import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { productAttributes } from '../../packages/db/src/category-model.js';
import { createDatabase } from '../../packages/db/src/client.js';
import { PostgresDiscoverySessionRepository } from '../../packages/db/src/discovery-session-repository.js';
import {
  connections,
  discoverySessions,
  importOutboxEvents,
  importRuns,
  inventory,
  merchants,
  offers,
  products,
  searchEvents,
  variants,
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
const variantA = 'a1000000-0000-4000-8000-000000000005';
const variantB = 'b1000000-0000-4000-8000-000000000005';
const offerA = 'a1000000-0000-4000-8000-000000000006';
const offerB = 'b1000000-0000-4000-8000-000000000006';

beforeAll(async () => {
  await adminDatabase.db.execute(
    sql`truncate table ${importOutboxEvents}, ${importRuns}, ${searchEvents}, ${discoverySessions}, ${inventory}, ${offers}, ${variants}, ${productAttributes}, ${products}, ${connections}, ${merchants} cascade`,
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
  await adminDatabase.db.insert(variants).values([
    {
      id: variantA,
      merchantId: tenantA,
      productId: productA,
      connectionId: 'a1000000-0000-4000-8000-000000000002',
      externalId: 'a-variant',
      size: 'M',
      color: 'black',
      observedAt: new Date(),
    },
    {
      id: variantB,
      merchantId: tenantB,
      productId: productB,
      connectionId: 'b1000000-0000-4000-8000-000000000002',
      externalId: 'b-variant',
      size: 'L',
      color: 'white',
      observedAt: new Date(),
    },
  ]);
  await adminDatabase.db.insert(offers).values([
    {
      id: offerA,
      merchantId: tenantA,
      variantId: variantA,
      connectionId: 'a1000000-0000-4000-8000-000000000002',
      externalId: 'a-offer',
      priceMinor: 10_000,
      currency: 'TRY',
      checkoutUrl: 'https://example.com/a',
      active: true,
      observedAt: new Date(),
    },
    {
      id: offerB,
      merchantId: tenantB,
      variantId: variantB,
      connectionId: 'b1000000-0000-4000-8000-000000000002',
      externalId: 'b-offer',
      priceMinor: 20_000,
      currency: 'TRY',
      checkoutUrl: 'https://example.com/b',
      active: true,
      observedAt: new Date(),
    },
  ]);
  await adminDatabase.db.insert(inventory).values([
    {
      offerId: offerA,
      merchantId: tenantA,
      available: true,
      observedAt: new Date(),
    },
    {
      offerId: offerB,
      merchantId: tenantB,
      available: true,
      observedAt: new Date(),
    },
  ]);
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

  it('hides every private merchant catalog layer from the public database role', async () => {
    const visible = await applicationDatabase.db.transaction(async (tx) => {
      await tx.execute(sql`set local role shopai_public`);
      return {
        merchants: await tx.select({ id: merchants.id }).from(merchants),
        products: await tx.select({ id: products.id }).from(products),
        variants: await tx.select({ id: variants.id }).from(variants),
        offers: await tx.select({ id: offers.id }).from(offers),
        inventory: await tx
          .select({ offerId: inventory.offerId })
          .from(inventory),
      };
    });

    expect(visible).toEqual({
      merchants: [{ id: tenantA }],
      products: [{ id: productA }],
      variants: [{ id: variantA }],
      offers: [{ id: offerA }],
      inventory: [{ offerId: offerA }],
    });
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

  it('rejects public telemetry writes for a private merchant', async () => {
    await expect(
      applicationDatabase.db.transaction(async (tx) => {
        await tx.execute(sql`set local role shopai_public`);
        return tx.insert(searchEvents).values({
          merchantId: tenantB,
          transport: 'rest',
          surface: 'web',
          requestKind: 'initial',
          outcome: 'results',
        });
      }),
    ).rejects.toThrow();

    await expect(
      applicationDatabase.db.transaction(async (tx) => {
        await tx.execute(sql`set local role shopai_public`);
        return tx.insert(searchEvents).values({
          merchantId: tenantA,
          transport: 'rest',
          surface: 'web',
          requestKind: 'initial',
          outcome: 'results',
        });
      }),
    ).resolves.toBeDefined();
  });

  it('prevents public-role discovery session table scans while repository lookup still works', async () => {
    const repository = new PostgresDiscoverySessionRepository(
      applicationDatabase.db,
    );
    const created = await repository.create({
      surface: 'web',
      transport: 'rest',
      merchantScope: [tenantA],
      referrer: null,
      campaign: null,
      anonymousUserId: 'a2000000-0000-4000-8000-000000000001',
      userId: null,
    });

    await expect(
      applicationDatabase.db.transaction(async (tx) => {
        await tx.execute(sql`set local role shopai_public`);
        return tx.select({ id: discoverySessions.id }).from(discoverySessions);
      }),
    ).resolves.toEqual([]);
    await expect(repository.findById(created.id)).resolves.toEqual(created);
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
