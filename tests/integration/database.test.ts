import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { Queue, QueueEvents, Worker } from 'bullmq';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { requeueFailedImport } from '../../apps/api/src/routes/imports.js';
import { redisConnection } from '../../apps/worker/src/connection.js';
import { enqueueImportOutboxEvent } from '../../apps/worker/src/outbox.js';
import {
  processImportJob,
  processImportReference,
} from '../../apps/worker/src/process-import.js';
import { syncCatalogConnection } from '../../apps/worker/src/sync.js';
import { DemoQueryParser } from '../../packages/ai/src/index.js';
import {
  SearchProducts,
  STOCK_REVALIDATE_AFTER_MS,
  STOCK_STALE_AFTER_MS,
  stockStatus,
} from '../../packages/commerce/src/index.js';
import {
  type LiveCatalogConnector,
  parseCatalogCsv,
  WooCommerceConnector,
} from '../../packages/connectors/src/index.js';
import {
  IMPORT_QUEUE,
  type ImportJob,
  searchResponseSchema,
} from '../../packages/contracts/src/index.js';
import { PostgresCatalogRepository } from '../../packages/db/src/catalog-repository.js';
import { createDatabase } from '../../packages/db/src/client.js';
import { importCatalog } from '../../packages/db/src/import-catalog.js';
import {
  connections,
  importOutboxEvents,
  importRuns,
  inventory,
  merchantCredentialOwnerships,
  merchants,
  offers,
  products,
  variants,
} from '../../packages/db/src/schema.js';
import { seedDemo } from '../../packages/db/src/seed.js';
import { setTenantContext } from '../../packages/db/src/tenant-context.js';

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
if (!databaseUrl) throw new Error('database.test için DATABASE_URL gerekli.');
const database = createDatabase(databaseUrl);
const merchantA = 'a0000000-0000-4000-8000-000000000001';
const merchantB = 'b0000000-0000-4000-8000-000000000001';
const connectionA = 'a0000000-0000-4000-8000-000000000002';
const connectionB = 'b0000000-0000-4000-8000-000000000002';

function row(overrides: Partial<ImportJob['rows'][number]> = {}) {
  return {
    externalId: 'variant-1',
    productKey: 'product-1',
    title: 'Test Ürünü',
    description: 'Test açıklaması',
    category: 'Tişört',
    size: 'M',
    color: 'Siyah',
    priceMinor: 10000,
    currency: 'TRY' as const,
    available: true,
    checkoutUrl: 'https://example.com/products/1',
    ...overrides,
  };
}

function job(overrides: Partial<ImportJob> = {}): ImportJob {
  return {
    schemaVersion: 1,
    runId: randomUUID(),
    observedAt: '2026-01-02T12:00:00.000Z',
    merchantId: merchantA,
    connectionId: connectionA,
    rows: [row()],
    ...overrides,
  };
}

async function counts() {
  const [result] = await database.db
    .select({
      products: sql<number>`(select count(*)::int from ${products})`,
      variants: sql<number>`(select count(*)::int from ${variants})`,
      offers: sql<number>`(select count(*)::int from ${offers})`,
    })
    .from(sql`(select 1) as one`);
  return result;
}

beforeEach(async () => {
  await database.db.execute(
    sql`truncate table ${importRuns}, ${inventory}, ${offers}, ${variants}, ${products}, ${connections}, ${merchants} cascade`,
  );
  await database.db.insert(merchants).values([
    {
      id: merchantA,
      name: 'A',
      slug: `a-${randomUUID()}`,
      active: true,
      isPublic: true,
    },
    {
      id: merchantB,
      name: 'B',
      slug: `b-${randomUUID()}`,
      active: true,
      isPublic: true,
    },
  ]);
  await database.db.insert(connections).values([
    { id: connectionA, merchantId: merchantA, provider: 'csv' },
    { id: connectionB, merchantId: merchantB, provider: 'csv' },
  ]);
  await database.db.insert(merchantCredentialOwnerships).values([
    {
      merchantId: merchantA,
      provider: 'woocommerce',
      credentialsRef: 'secret://PILOT_WOO',
    },
  ]);
});

afterAll(async () => database.close());

describe('catalog import integrity on PostgreSQL', () => {
  it('skips a connection when its secret reference is not owned by the merchant', async () => {
    await database.db.delete(merchantCredentialOwnerships);
    await database.db
      .update(connections)
      .set({
        provider: 'woocommerce',
        credentialsRef: 'secret://PILOT_WOO',
        authorizationStatus: 'active',
      })
      .where(eq(connections.id, connectionA));
    const secrets = { resolve: vi.fn(async () => ({})) };

    await expect(
      syncCatalogConnection(
        database.db,
        { merchantId: merchantA, connectionId: connectionA },
        secrets,
      ),
    ).resolves.toEqual({ skipped: true });
    expect(secrets.resolve).not.toHaveBeenCalled();
  });

  it('applies a complete live sync idempotently and skips revoked connections', async () => {
    await database.db
      .update(connections)
      .set({
        provider: 'woocommerce',
        credentialsRef: 'secret://PILOT_WOO',
        authorizationStatus: 'active',
        syncMode: 'full',
      })
      .where(eq(connections.id, connectionA));
    let price = 123400;
    const connector = (): LiveCatalogConnector => ({
      provider: 'woocommerce',
      capabilities: { liveInventory: true, incrementalSync: true },
      validate: async () => undefined,
      readPage: async () => ({
        rows: [row({ priceMinor: price, available: false })],
        nextCursor: null,
        sourceObservedAt: new Date().toISOString(),
        fetchedAt: new Date().toISOString(),
        complete: true,
      }),
    });
    const secrets = { resolve: async () => ({}) };
    await syncCatalogConnection(
      database.db,
      { merchantId: merchantA, connectionId: connectionA },
      secrets,
      connector,
    );
    price = 125000;
    await syncCatalogConnection(
      database.db,
      { merchantId: merchantA, connectionId: connectionA },
      secrets,
      connector,
    );
    expect(await counts()).toEqual({ products: 1, variants: 1, offers: 1 });
    expect(
      await database.db.select({ price: offers.priceMinor }).from(offers),
    ).toEqual([{ price: 125000 }]);

    await database.db
      .update(connections)
      .set({ active: false, authorizationStatus: 'revoked' })
      .where(eq(connections.id, connectionA));
    const factory = vi.fn(connector);
    expect(
      await syncCatalogConnection(
        database.db,
        { merchantId: merchantA, connectionId: connectionA },
        secrets,
        factory,
      ),
    ).toEqual({ skipped: true });
    expect(factory).not.toHaveBeenCalled();
  });

  it('revalidates unchanged inventory with a verified full read before it becomes stale', async () => {
    const initialTime = new Date();
    let currentTime = initialTime;
    await database.db
      .update(connections)
      .set({
        provider: 'woocommerce',
        credentialsRef: 'secret://PILOT_WOO',
        authorizationStatus: 'active',
        syncMode: 'incremental',
        lastSuccessfulSyncAt: new Date('2026-01-02T12:00:00.000Z'),
      })
      .where(eq(connections.id, connectionA));
    await importCatalog(database.db, job());
    await database.db.update(inventory).set({ fetchedAt: initialTime });
    const requests: Array<{ mode: string; modifiedAfter?: string | null }> = [];
    const connector: LiveCatalogConnector = {
      provider: 'woocommerce',
      capabilities: { liveInventory: true, incrementalSync: true },
      validate: async () => undefined,
      readPage: async (input) => {
        requests.push(input);
        return {
          rows: input.mode === 'full' ? [row()] : [],
          nextCursor: null,
          sourceObservedAt: '2026-01-02T12:00:00.000Z',
          fetchedAt: currentTime.toISOString(),
          complete: true,
        };
      },
    };

    currentTime = new Date(
      initialTime.getTime() + STOCK_REVALIDATE_AFTER_MS - 60_000,
    );
    await expect(
      syncCatalogConnection(
        database.db,
        { merchantId: merchantA, connectionId: connectionA },
        { resolve: async () => ({}) },
        () => connector,
        () => currentTime,
      ),
    ).resolves.toMatchObject({ imported: 0, mode: 'incremental' });
    const [afterIncremental] = await database.db
      .select({ fetchedAt: inventory.fetchedAt })
      .from(inventory);
    expect(afterIncremental?.fetchedAt).toEqual(initialTime);

    currentTime = new Date(
      initialTime.getTime() + STOCK_REVALIDATE_AFTER_MS + 60_000,
    );
    await expect(
      syncCatalogConnection(
        database.db,
        { merchantId: merchantA, connectionId: connectionA },
        { resolve: async () => ({}) },
        () => connector,
        () => currentTime,
      ),
    ).resolves.toMatchObject({ imported: 1, mode: 'full' });
    const [afterRevalidation] = await database.db
      .select({ fetchedAt: inventory.fetchedAt })
      .from(inventory);
    expect(requests).toMatchObject([
      {
        mode: 'incremental',
        modifiedAfter: '2026-01-02T12:00:00.000Z',
      },
      { mode: 'full', modifiedAfter: null },
    ]);
    expect(afterRevalidation).toBeDefined();
    if (!afterRevalidation)
      throw new Error('Yeniden doğrulanan stok bulunamadı.');
    expect(afterRevalidation.fetchedAt.getTime()).toBeGreaterThan(
      initialTime.getTime(),
    );
    expect(
      stockStatus(
        true,
        afterRevalidation.fetchedAt.toISOString(),
        currentTime.getTime(),
      ),
    ).toBe('in_stock');
  });

  it('does not refresh or deactivate inventory when scheduled revalidation fails', async () => {
    const currentTime = new Date();
    const lastVerifiedAt = new Date(
      currentTime.getTime() - STOCK_REVALIDATE_AFTER_MS - 60_000,
    );
    await database.db
      .update(connections)
      .set({
        provider: 'woocommerce',
        credentialsRef: 'secret://PILOT_WOO',
        authorizationStatus: 'active',
        syncMode: 'incremental',
        lastSuccessfulSyncAt: new Date('2026-01-02T12:00:00.000Z'),
      })
      .where(eq(connections.id, connectionA));
    await importCatalog(
      database.db,
      job({ rows: [row(), row({ externalId: 'variant-2' })] }),
    );
    await database.db.update(inventory).set({ fetchedAt: lastVerifiedAt });
    const requestedModes: string[] = [];
    const connector: LiveCatalogConnector = {
      provider: 'woocommerce',
      capabilities: { liveInventory: true, incrementalSync: true },
      validate: async () => undefined,
      readPage: async (input) => {
        requestedModes.push(input.mode);
        throw new Error('revalidation unavailable');
      },
    };

    await expect(
      syncCatalogConnection(
        database.db,
        { merchantId: merchantA, connectionId: connectionA },
        { resolve: async () => ({}) },
        () => connector,
        () => currentTime,
      ),
    ).rejects.toThrow('revalidation unavailable');
    expect(requestedModes).toEqual(['full']);
    expect(
      await database.db
        .select({ fetchedAt: inventory.fetchedAt })
        .from(inventory),
    ).toEqual([{ fetchedAt: lastVerifiedAt }, { fetchedAt: lastVerifiedAt }]);
    expect(
      await database.db.select({ active: offers.active }).from(offers),
    ).toEqual([{ active: true }, { active: true }]);
    expect(
      stockStatus(
        true,
        lastVerifiedAt.toISOString(),
        currentTime.getTime() + STOCK_STALE_AFTER_MS,
      ),
    ).toBe('stale');
  });

  it('does not deactivate existing offers after an incomplete full snapshot', async () => {
    await database.db
      .update(connections)
      .set({
        provider: 'woocommerce',
        credentialsRef: 'secret://PILOT_WOO',
        authorizationStatus: 'active',
        syncMode: 'full',
      })
      .where(eq(connections.id, connectionA));
    await importCatalog(
      database.db,
      job({ rows: [row(), row({ externalId: 'variant-2' })] }),
    );
    const connector: LiveCatalogConnector = {
      provider: 'woocommerce',
      capabilities: { liveInventory: true, incrementalSync: true },
      validate: async () => undefined,
      readPage: async ({ cursor }) => {
        if (cursor) throw new Error('temporary disconnect');
        return {
          rows: [row()],
          nextCursor: '2',
          sourceObservedAt: '2026-09-08T00:00:00.000Z',
          fetchedAt: new Date().toISOString(),
          complete: false,
        };
      },
    };
    await expect(
      syncCatalogConnection(
        database.db,
        { merchantId: merchantA, connectionId: connectionA },
        { resolve: async () => ({}) },
        () => connector,
      ),
    ).rejects.toThrow('temporary disconnect');
    expect(
      await database.db.select({ active: offers.active }).from(offers),
    ).toEqual([{ active: true }, { active: true }]);
  });

  it.each([
    ['missing header', [undefined]],
    ['invalid header', ['not-a-number']],
    ['missing header on the final variation page', ['2', undefined]],
  ] as const)(
    'does not deactivate offers when variation pagination has a %s',
    async (_case, variationHeaders) => {
      await database.db
        .update(connections)
        .set({
          provider: 'woocommerce',
          credentialsRef: 'secret://PILOT_WOO',
          authorizationStatus: 'active',
          syncMode: 'full',
        })
        .where(eq(connections.id, connectionA));
      await importCatalog(
        database.db,
        job({
          rows: [
            row({ externalId: '101' }),
            row({ externalId: '102', size: 'L' }),
            row({ externalId: '103', size: 'XL' }),
          ],
        }),
      );
      const variableProduct = {
        id: 1,
        type: 'variable',
        name: 'Test Ürünü',
        description: 'Test açıklaması',
        permalink: 'https://example.com/products/1',
        price: '',
        status: 'publish',
        date_modified_gmt: '2026-09-08T00:00:00',
        categories: [{ slug: 'tisort' }],
        attributes: [{ name: 'Beden', options: ['M', 'L', 'XL'] }],
      };
      const fetcher = vi.fn(async (input: URL | RequestInfo) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith('/variations')) {
          const page = Number(url.searchParams.get('page'));
          const totalPages = variationHeaders[page - 1];
          return new Response(
            JSON.stringify([
              {
                id: 100 + page,
                price: '100.00',
                stock_status: 'instock',
                date_modified_gmt: '2026-09-08T00:00:00',
                attributes: [{ name: 'Beden', option: page === 1 ? 'M' : 'L' }],
              },
            ]),
            {
              status: 200,
              headers: totalPages
                ? { 'x-wp-totalpages': totalPages }
                : undefined,
            },
          );
        }
        return new Response(JSON.stringify([variableProduct]), {
          status: 200,
          headers: { 'x-wp-totalpages': '1' },
        });
      });
      const connector = new WooCommerceConnector(
        {
          storeUrl: 'https://example.com',
          consumerKey: 'ck_test',
          consumerSecret: 'cs_test',
        },
        fetcher as typeof fetch,
      );

      await expect(
        syncCatalogConnection(
          database.db,
          { merchantId: merchantA, connectionId: connectionA },
          { resolve: async () => ({}) },
          () => connector,
        ),
      ).rejects.toThrow('snapshot sayfa sınırında tamamlanamadı');
      expect(
        await database.db
          .select({ externalId: offers.externalId, active: offers.active })
          .from(offers)
          .orderBy(offers.externalId),
      ).toEqual([
        { externalId: '101', active: true },
        { externalId: '102', active: true },
        { externalId: '103', active: true },
      ]);
    },
  );
  it('implements the same free-text search response contract as memory', async () => {
    await importCatalog(
      database.db,
      job({
        observedAt: new Date().toISOString(),
        rows: [
          row({
            title: 'Özel Keten Gömlek',
            description: 'Nefes alan yazlık ürün',
            category: 'Gömlek',
          }),
        ],
      }),
    );
    await database.db.transaction(async (tx) => {
      await setTenantContext(tx, merchantA);
      await tx
        .update(products)
        .set({ published: true })
        .where(eq(products.merchantId, merchantA));
    });
    const search = new SearchProducts(
      new PostgresCatalogRepository(database.db),
      new DemoQueryParser(),
      'postgres',
    );
    const result = await search.execute({
      query: 'keten gömlek',
      filters: { inStockOnly: false },
    });
    expect(searchResponseSchema.parse(result).items[0]?.title).toBe(
      'Özel Keten Gömlek',
    );
  });

  it('is idempotent for duplicate and concurrent jobs', async () => {
    const sameJob = job();
    await importCatalog(database.db, sameJob);
    await expect(importCatalog(database.db, sameJob)).resolves.toMatchObject({
      duplicate: true,
    });
    await Promise.all([
      importCatalog(
        database.db,
        job({ rows: [row({ externalId: 'variant-2' })] }),
      ),
      importCatalog(
        database.db,
        job({ rows: [row({ externalId: 'variant-2' })] }),
      ),
    ]);
    expect(await counts()).toEqual({ products: 1, variants: 2, offers: 2 });
  });

  it('rolls the whole transaction back after a middle-row database error', async () => {
    await database.db.execute(sql`
      create function fail_test_offer() returns trigger language plpgsql as $$
      begin
        if new.external_id = 'boom' then raise exception 'test failure'; end if;
        return new;
      end $$;
    `);
    await database.db.execute(sql`
      create trigger fail_test_offer before insert on offers
      for each row execute function fail_test_offer()
    `);
    try {
      await expect(
        importCatalog(
          database.db,
          job({
            rows: [
              row(),
              row({
                externalId: 'boom',
                productKey: 'product-2',
                title: 'İkinci',
              }),
            ],
          }),
        ),
      ).rejects.toThrow('Failed query');
      expect(await counts()).toEqual({ products: 0, variants: 0, offers: 0 });
    } finally {
      await database.db.execute(sql`drop trigger fail_test_offer on offers`);
      await database.db.execute(sql`drop function fail_test_offer()`);
    }
  });

  it('does not let an old snapshot overwrite current price or stock', async () => {
    await importCatalog(
      database.db,
      job({
        observedAt: '2026-01-03T12:00:00.000Z',
        rows: [row({ priceMinor: 25000, available: false })],
      }),
    );
    await expect(
      importCatalog(
        database.db,
        job({ observedAt: '2026-01-01T12:00:00.000Z' }),
      ),
    ).resolves.toMatchObject({ stale: true, imported: 0 });
    const [stored] = await database.db
      .select({ price: offers.priceMinor, available: inventory.available })
      .from(offers)
      .innerJoin(inventory, eq(inventory.offerId, offers.id));
    expect(stored).toEqual({ price: 25000, available: false });
  });

  it('keeps an explicit publication decision across a newer import', async () => {
    const first = job({
      observedAt: '2026-01-03T12:00:00.000Z',
      rows: [row({ priceMinor: 25000 })],
    });
    await importCatalog(database.db, first);
    await database.db
      .update(products)
      .set({ published: true })
      .where(eq(products.merchantId, merchantA));
    await importCatalog(
      database.db,
      job({
        observedAt: '2026-01-04T12:00:00.000Z',
        rows: [row({ priceMinor: 27000, available: false })],
      }),
    );
    const [stored] = await database.db
      .select({ published: products.published, price: offers.priceMinor })
      .from(products)
      .innerJoin(variants, eq(variants.productId, products.id))
      .innerJoin(offers, eq(offers.variantId, variants.id));
    expect(stored).toEqual({ published: true, price: 27000 });
  });

  it('rejects cross-merchant connections and conflicting product identity', async () => {
    await expect(
      importCatalog(database.db, job({ connectionId: connectionB })),
    ).rejects.toThrow('Aktif bağlantı bu mağazaya ait değil');
    await expect(
      importCatalog(
        database.db,
        job({
          rows: [row(), row({ externalId: 'variant-2', title: 'Çelişkili' })],
        }),
      ),
    ).rejects.toThrow('çelişkili ürün bilgisi');
    expect(await counts()).toEqual({ products: 0, variants: 0, offers: 0 });
  });
});

describe('CSV queue and demo seed', () => {
  it.skipIf(!redisUrl)(
    'processes CSV through Redis and the worker into PostgreSQL',
    async () => {
      const csv = [
        'external_id,product_key,title,description,category,size,color,price_minor,currency,available,checkout_url',
        'queued-1,queued-product,Kuyruk Ürünü,Açıklama,Tişört,L,Mavi,12345,TRY,true,https://example.com/queued',
      ].join('\n');
      const parsed = parseCatalogCsv(csv);
      expect(parsed.errors).toEqual([]);
      const queueName = `${IMPORT_QUEUE}-${randomUUID()}`;
      if (!redisUrl) throw new Error('REDIS_URL gerekli.');
      const connection = redisConnection(redisUrl);
      const worker = new Worker(
        queueName,
        (queuedJob) =>
          processImportJob(database.db, queuedJob.name, queuedJob.data),
        { connection: { ...connection, maxRetriesPerRequest: null } },
      );
      const queue = new Queue(queueName, { connection });
      const events = new QueueEvents(queueName, { connection });
      try {
        await Promise.all([worker.waitUntilReady(), events.waitUntilReady()]);
        const queued = await queue.add(
          'csv-import',
          job({ rows: parsed.rows }),
        );
        await queued.waitUntilFinished(events, 15000);
        expect(await counts()).toEqual({ products: 1, variants: 1, offers: 1 });
      } finally {
        await Promise.all([worker.close(), events.close(), queue.close()]);
      }
    },
  );

  it.skipIf(!redisUrl)(
    'processes a manual retry after the retained queue job exhausts its attempts',
    async () => {
      if (!redisUrl) throw new Error('REDIS_URL gerekli.');
      const runId = randomUUID();
      const oldDispatchId = randomUUID();
      const directory = await mkdtemp(`${tmpdir()}/shopai-retry-`);
      const filePath = `${directory}/${runId}.csv`;
      await writeFile(
        filePath,
        [
          'external_id,product_key,title,description,category,size,color,price_minor,currency,available,checkout_url',
          'retried-1,retried-product,Yeniden Denenen,Açıklama,Tişört,M,Siyah,12345,TRY,true,https://example.com/retried',
        ].join('\n'),
      );
      await database.db.insert(importRuns).values({
        id: runId,
        merchantId: merchantA,
        connectionId: connectionA,
        rows: 0,
        observedAt: new Date(),
        status: 'failed',
        filePath,
        error: { message: 'initial failure' },
        completedAt: new Date(),
      });
      await database.db.insert(importOutboxEvents).values({
        id: randomUUID(),
        runId,
        merchantId: merchantA,
        payload: {
          runId,
          dispatchId: oldDispatchId,
          merchantId: merchantA,
          connectionId: connectionA,
          filePath,
        },
        publishedAt: new Date(),
      });

      const queueName = `${IMPORT_QUEUE}-manual-retry-${randomUUID()}`;
      const connection = redisConnection(redisUrl);
      const queue = new Queue(queueName, { connection });
      const events = new QueueEvents(queueName, { connection });
      const worker = new Worker(
        queueName,
        (queuedJob) =>
          queuedJob.data.dispatchId === oldDispatchId
            ? Promise.reject(new Error('automatic attempts exhausted'))
            : processImportReference(database.db, queuedJob.data),
        { connection: { ...connection, maxRetriesPerRequest: null } },
      );
      try {
        await Promise.all([worker.waitUntilReady(), events.waitUntilReady()]);
        const retained = await queue.add(
          'csv-import',
          {
            runId,
            dispatchId: oldDispatchId,
            merchantId: merchantA,
            connectionId: connectionA,
            filePath,
          },
          {
            jobId: `${runId}-${oldDispatchId}`,
            attempts: 2,
            backoff: { type: 'fixed', delay: 1 },
          },
        );
        await expect(retained.waitUntilFinished(events, 15000)).rejects.toThrow(
          'automatic attempts exhausted',
        );
        expect(await retained.getState()).toBe('failed');

        const { dispatchId } = await requeueFailedImport(
          database.db,
          merchantA,
          runId,
        );
        const [event] = await database.db
          .select()
          .from(importOutboxEvents)
          .where(eq(importOutboxEvents.runId, runId));
        if (!event) throw new Error('Retry outbox olayı bulunamadı.');
        const retried = await enqueueImportOutboxEvent(queue, event);
        expect(retried.id).toBe(`${runId}-${dispatchId}`);
        expect(retried.id).not.toBe(retained.id);
        await retried.waitUntilFinished(events, 15000);

        const [completed] = await database.db
          .select({ status: importRuns.status })
          .from(importRuns)
          .where(eq(importRuns.id, runId));
        expect(completed?.status).toBe('completed');
        expect(await counts()).toEqual({ products: 1, variants: 1, offers: 1 });
      } finally {
        await Promise.all([worker.close(), events.close(), queue.close()]);
        await rm(directory, { recursive: true, force: true });
      }
    },
  );

  it('publishes only known synthetic products when seed is rerun', async () => {
    await seedDemo(database.db);
    await importCatalog(
      database.db,
      job({
        merchantId: '10000000-0000-4000-8000-000000000001',
        connectionId: '10000000-0000-4000-8000-000000000002',
        observedAt: new Date(Date.now() + 1000).toISOString(),
        rows: [row({ externalId: 'later-draft', productKey: 'later-draft' })],
      }),
    );
    await seedDemo(database.db);
    const [draft] = await database.db
      .select({ published: products.published })
      .from(products)
      .where(
        and(
          eq(products.merchantId, '10000000-0000-4000-8000-000000000001'),
          eq(products.externalKey, 'later-draft'),
        ),
      );
    expect(draft?.published).toBe(false);
  });
});
