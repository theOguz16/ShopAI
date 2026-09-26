import { randomUUID } from 'node:crypto';
import { count, eq, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  beginSyncRun,
  type BeginSyncRunResult,
} from '../../packages/db/src/sync-checkpoint.js';
import { runCatalogSyncEngine } from '../../apps/worker/src/catalog-sync-engine.js';
import { syncCatalogConnection } from '../../apps/worker/src/sync.js';
import type { LiveCatalogConnector } from '../../packages/connectors/src/index.js';
import type {
  ImportJob,
  SourceRow,
} from '../../packages/contracts/src/index.js';
import {
  connections,
  connectionSyncProgress,
  createDatabase,
  importCatalog,
  importRuns,
  inventory,
  markSyncRunFailed,
  merchantCredentialOwnerships,
  merchants,
  offers,
  products,
  sourceCategoryMappings,
  syncConnectionLeases,
  syncRunCheckpoints,
  SyncLeaseLostError,
  upsertSyncCheckpoint,
  variants,
  writeConnectionSyncProgress,
} from '../../packages/db/src/index.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl)
  throw new Error('bounded-memory-sync.test için DATABASE_URL gerekli.');

const database = createDatabase(databaseUrl, {
  applicationName: 'shopai-bounded-memory-sync',
});
const merchantId = 'cb000000-0000-4000-8000-000000000001';
const connectionId = 'cb000000-0000-4000-8000-000000000002';
const CREDENTIALS_REF = 'secret://BOUNDED_SYNC_TEST';

function variantRow(index: number, productKey?: string): SourceRow {
  return {
    externalId: `variant-${index}`,
    productKey: productKey ?? `product-${index}`,
    title: `Ürün ${productKey ?? index}`,
    description: 'Bounded memory sync fixture',
    category: 'tshirt',
    imageUrl: null,
    imageAlt: null,
    size: 'M',
    color: 'black',
    priceMinor: 10_000 + index,
    currency: 'TRY',
    available: true,
    checkoutUrl: `https://example.com/products/${index}`,
  };
}

type FakePage = {
  rows: SourceRow[];
  nextCursor: string | null;
  complete: boolean;
  sourceObservedAt?: string;
};

function recordedConnector(pages: FakePage[]) {
  const cursors: Array<string | null> = [];
  const readPage = async ({ cursor }: { cursor?: string | null }) => {
    cursors.push(cursor ?? null);
    const index = cursor ? Number(cursor) : 0;
    const page = pages[index];
    if (!page) throw new Error(`Fixture sayfası yok: ${String(cursor)}`);
    return {
      rows: page.rows,
      nextCursor: page.nextCursor,
      sourceObservedAt: page.sourceObservedAt ?? '2026-09-20T08:00:00.000Z',
      fetchedAt: '2026-09-20T08:01:00.000Z',
      complete: page.complete,
    };
  };
  return {
    cursors,
    connector: {
      provider: 'woocommerce',
      capabilities: { liveInventory: true, incrementalSync: true },
      validate: async () => undefined,
      readPage,
    } satisfies LiveCatalogConnector,
  };
}

async function tableCount(
  table: typeof products | typeof offers | typeof variants | typeof inventory,
) {
  const [row] = await database.db.select({ value: count() }).from(table);
  return row?.value ?? 0;
}

async function installProductTrigger(externalKey: string) {
  // Test-constant input only; sql.raw keeps each DDL statement single-command.
  await database.db.execute(
    sql.raw(`CREATE OR REPLACE FUNCTION fail_bounded_sync_product() RETURNS trigger AS $$
      BEGIN
        IF NEW.external_key = '${externalKey}' THEN
          RAISE EXCEPTION 'controlled bounded sync failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;`),
  );
  await database.db.execute(
    sql.raw('DROP TRIGGER IF EXISTS fail_bounded_sync_product ON products;'),
  );
  await database.db.execute(
    sql.raw(`CREATE TRIGGER fail_bounded_sync_product
      BEFORE INSERT OR UPDATE ON products
      FOR EACH ROW EXECUTE FUNCTION fail_bounded_sync_product();`),
  );
}

async function dropProductTrigger() {
  await database.db.execute(sql`
    DROP TRIGGER IF EXISTS fail_bounded_sync_product ON products;
    DROP FUNCTION IF EXISTS fail_bounded_sync_product();
  `);
}

beforeEach(async () => {
  await dropProductTrigger();
  await database.db.execute(
    sql`truncate table ${syncConnectionLeases}, ${syncRunCheckpoints}, ${connectionSyncProgress}, ${importRuns}, ${inventory}, ${offers}, ${variants}, ${products}, ${sourceCategoryMappings}, ${connections}, ${merchants} cascade`,
  );
  await database.db.insert(merchants).values({
    id: merchantId,
    name: 'Bounded Store',
    slug: `bounded-${randomUUID()}`,
    active: true,
    isPublic: true,
  });
  await database.db.insert(connections).values({
    id: connectionId,
    merchantId,
    provider: 'woocommerce',
    credentialsRef: CREDENTIALS_REF,
    authorizationStatus: 'active',
    syncMode: 'full',
  });
  await database.db.insert(merchantCredentialOwnerships).values({
    merchantId,
    provider: 'woocommerce',
    credentialsRef: CREDENTIALS_REF,
  });
});

afterAll(async () => {
  await dropProductTrigger();
  await database.close();
});

function engineInput(
  connector: LiveCatalogConnector,
  syncRunId: string,
  options: {
    batchSize?: number;
    onChunkCommitted?: (info: unknown) => void;
  } = {},
) {
  return {
    db: database.db,
    job: { merchantId, connectionId },
    syncRunId,
    connector,
    mode: 'full' as const,
    modifiedAfter: null,
    credentialsRef: CREDENTIALS_REF,
    batchSize: options.batchSize,
    onChunkCommitted: options.onChunkCommitted,
  };
}

describe.sequential('ÜRÜN-007 bounded-memory catalog sync', () => {
  it('imports a multi-page catalog completely (acceptance 1)', async () => {
    const pages = [1, 2, 3].map((page) => ({
      rows: [variantRow(page * 10 + 1), variantRow(page * 10 + 2)],
      nextCursor: page < 3 ? String(page) : null,
      complete: page === 3,
    }));
    const { connector } = recordedConnector(pages);

    const result = await runCatalogSyncEngine(
      engineInput(connector, randomUUID()),
    );

    expect(result).toMatchObject({
      kind: 'completed',
      imported: 6,
      mode: 'full',
    });
    expect(await tableCount(products)).toBe(6);
    expect(await tableCount(variants)).toBe(6);
    expect(await tableCount(offers)).toBe(6);
    expect(await tableCount(inventory)).toBe(6);
    if (result.kind !== 'completed') throw new Error('unreachable');
    expect(result.counters).toMatchObject({
      pages: 3,
      chunks: 3,
      rowsProcessed: 6,
      productsProcessed: 6,
      sourceComplete: true,
      cursor: null,
    });
    const [checkpoint] = await database.db
      .select()
      .from(syncRunCheckpoints)
      .where(eq(syncRunCheckpoints.connectionId, connectionId));
    expect(checkpoint).toMatchObject({
      status: 'completed',
      pages: 3,
      chunks: 3,
      rowsProcessed: 6,
      cursor: null,
    });
    const [connection] = await database.db
      .select()
      .from(connections)
      .where(eq(connections.id, connectionId));
    expect(connection.lastSuccessfulSyncAt).not.toBeNull();
    expect(connection.lastSourceWatermarkAt?.toISOString()).toBe(
      '2026-09-20T08:00:00.000Z',
    );
  });

  it('keeps product/variant identity, links and per-variant offers (acceptance 2)', async () => {
    const rows = [
      variantRow(1, 'product-shared'),
      variantRow(2, 'product-shared'),
    ];
    const { connector } = recordedConnector([
      { rows, nextCursor: null, complete: true },
    ]);

    await runCatalogSyncEngine(engineInput(connector, randomUUID()));

    const [product] = await database.db
      .select()
      .from(products)
      .where(eq(products.externalKey, 'product-shared'));
    const variantRows = await database.db
      .select()
      .from(variants)
      .where(eq(variants.externalId, 'variant-1'));
    expect(variantRows).toHaveLength(1);
    expect(variantRows[0]?.productId).toBe(product?.id);
    expect(await tableCount(products)).toBe(1);
    expect(await tableCount(variants)).toBe(2);
    const offerRows = await database.db
      .select()
      .from(offers)
      .where(eq(offers.externalId, 'variant-2'));
    expect(offerRows).toHaveLength(1);
    const [variant2] = await database.db
      .select()
      .from(variants)
      .where(eq(variants.externalId, 'variant-2'));
    expect(offerRows[0]?.variantId).toBe(variant2?.id);
    expect(offerRows[0]?.priceMinor).toBe(10_002);
    expect(offerRows[0]?.checkoutUrl).toBe('https://example.com/products/2');
  });

  it('preserves generic product attributes and variant options (acceptance 3)', async () => {
    const row: SourceRow = {
      ...variantRow(1),
      productAttributes: [
        {
          key: 'material',
          label: 'Malzeme',
          value: 'pamuk',
          sourceKey: 'Malzeme',
        },
      ],
      variantOptions: [
        { key: 'size', label: 'Beden', value: 'L', sourceKey: 'Beden' },
        { key: 'color', label: 'Renk', value: 'kırmızı', sourceKey: 'Renk' },
      ],
    };
    const { connector } = recordedConnector([
      { rows: [row], nextCursor: null, complete: true },
    ]);

    await runCatalogSyncEngine(engineInput(connector, randomUUID()));

    const [product] = await database.db.select().from(products);
    expect(product?.descriptiveAttributes).toEqual([
      {
        key: 'material',
        label: 'Malzeme',
        value: 'pamuk',
        sourceKey: 'Malzeme',
      },
    ]);
    const [variant] = await database.db.select().from(variants);
    // Canonical attribute order is key-sorted: option order is never identity.
    expect(variant?.options).toEqual([
      { key: 'color', label: 'Renk', value: 'kırmızı', sourceKey: 'Renk' },
      { key: 'size', label: 'Beden', value: 'L', sourceKey: 'Beden' },
    ]);
  });

  it('persists source category provenance with needs_mapping lifecycle (acceptance 4)', async () => {
    const row: SourceRow = {
      ...variantRow(1),
      sourceCategoryId: 'src-cat-1',
      sourceCategoryPath: ['Giyim', 'Tişört'],
    };
    const { connector } = recordedConnector([
      { rows: [row], nextCursor: null, complete: true },
    ]);

    await runCatalogSyncEngine(engineInput(connector, randomUUID()));

    const [mapping] = await database.db
      .select()
      .from(sourceCategoryMappings)
      .where(eq(sourceCategoryMappings.sourceCategoryId, 'src-cat-1'));
    expect(mapping).toMatchObject({
      merchantId,
      connectionId,
      provider: 'woocommerce',
      sourceCategoryId: 'src-cat-1',
      sourceCategoryName: 'tshirt',
      status: 'needs_mapping',
      canonicalCategorySlug: null,
    });
    expect(mapping?.sourceCategoryPath).toEqual(['Giyim', 'Tişört']);
    const [product] = await database.db.select().from(products);
    expect(product?.sourceCategoryId).toBe('src-cat-1');
  });

  it('never overwrites existing canonical category mappings (acceptance 5)', async () => {
    await database.db.insert(sourceCategoryMappings).values({
      merchantId,
      connectionId,
      provider: 'woocommerce',
      sourceCategoryId: 'src-cat-1',
      sourceCategoryName: 'Eski kaynak ad',
      status: 'mapped',
      canonicalCategorySlug: 'tshirt',
    });
    const row: SourceRow = {
      ...variantRow(1),
      category: 'Tişört',
      sourceCategoryId: 'src-cat-1',
      sourceCategoryPath: ['Giyim'],
    };
    const { connector } = recordedConnector([
      { rows: [row], nextCursor: null, complete: true },
    ]);

    await runCatalogSyncEngine(engineInput(connector, randomUUID()));

    const [mapping] = await database.db
      .select()
      .from(sourceCategoryMappings)
      .where(eq(sourceCategoryMappings.sourceCategoryId, 'src-cat-1'));
    expect(mapping?.status).toBe('mapped');
    expect(mapping?.canonicalCategorySlug).toBe('tshirt');
  });

  it('retries failed chunks idempotently without duplicates or corrupt partial state (acceptance 6, 9)', async () => {
    await importCatalog(database.db, {
      schemaVersion: 1,
      runId: randomUUID(),
      merchantId,
      connectionId,
      observedAt: '2026-09-19T08:00:00.000Z',
      rows: [
        {
          ...variantRow(9_999),
          externalId: 'legacy-variant',
          productKey: 'legacy-product',
        },
      ],
    } satisfies ImportJob);
    const rows = Array.from({ length: 1_200 }, (_, index) =>
      variantRow(index + 1),
    );
    const { connector } = recordedConnector([
      { rows, nextCursor: null, complete: true },
    ]);

    await installProductTrigger('product-1150');
    // Drizzle wraps pg errors; the failing insert itself proves the chunk
    // transaction aborted.
    await expect(
      runCatalogSyncEngine(
        engineInput(connector, randomUUID(), { batchSize: 1_000 }),
      ),
    ).rejects.toThrow('Failed query: insert into "products"');
    await dropProductTrigger();

    expect(await tableCount(products)).toBe(1_001);
    expect(await tableCount(offers)).toBe(1_001);
    const [legacyAfterFailure] = await database.db
      .select({ active: offers.active })
      .from(offers)
      .where(eq(offers.externalId, 'legacy-variant'));
    expect(legacyAfterFailure?.active).toBe(true);
    const [progress] = await database.db
      .select()
      .from(connectionSyncProgress)
      .where(eq(connectionSyncProgress.connectionId, connectionId));
    expect(progress).toMatchObject({
      status: 'partial',
      foundProducts: 1_200,
      processedProducts: 1_000,
      failedProducts: 200,
      variants: 1_200,
    });

    const { connector: retryConnector } = recordedConnector([
      { rows, nextCursor: null, complete: true },
    ]);
    await runCatalogSyncEngine(
      engineInput(retryConnector, randomUUID(), { batchSize: 1_000 }),
    );

    expect(await tableCount(products)).toBe(1_201);
    expect(await tableCount(offers)).toBe(1_201);
    const [dupCheck] = await database.db
      .select({
        value: sql<number>`count(distinct ${products.externalKey})::integer`,
      })
      .from(products);
    expect(dupCheck?.value).toBe(1_201);
    const [legacyAfterSuccess] = await database.db
      .select({ active: offers.active })
      .from(offers)
      .where(eq(offers.externalId, 'legacy-variant'));
    expect(legacyAfterSuccess?.active).toBe(false);
  });

  it('resumes from the durable checkpoint after a worker crash without re-fetching committed pages (acceptance 7)', async () => {
    const syncRunId = randomUUID();
    const pages = [1, 2, 3].map((page) => ({
      rows: [variantRow(page * 10 + 1), variantRow(page * 10 + 2)],
      nextCursor: page < 3 ? String(page) : null,
      complete: page === 3,
    }));
    const first = recordedConnector(pages);
    await installProductTrigger('product-31');
    await expect(
      runCatalogSyncEngine(engineInput(first.connector, syncRunId)),
    ).rejects.toThrow('Failed query: insert into "products"');
    await dropProductTrigger();

    const [checkpoint] = await database.db
      .select()
      .from(syncRunCheckpoints)
      .where(eq(syncRunCheckpoints.syncRunId, syncRunId));
    expect(checkpoint).toMatchObject({
      status: 'failed',
      pages: 2,
      cursor: '2',
    });

    const second = recordedConnector(pages);
    const result = await runCatalogSyncEngine(
      engineInput(second.connector, syncRunId),
    );
    expect(result).toMatchObject({ kind: 'completed', imported: 6 });
    expect(second.cursors).toEqual(['2']);
    expect(await tableCount(products)).toBe(6);
    expect(await tableCount(offers)).toBe(6);
    const [completed] = await database.db
      .select()
      .from(syncRunCheckpoints)
      .where(eq(syncRunCheckpoints.syncRunId, syncRunId));
    expect(completed).toMatchObject({
      status: 'completed',
      pages: 3,
      chunks: 3,
      rowsProcessed: 6,
      attempts: 2,
    });
  });

  it('never advances the checkpoint cursor before the chunk commits (acceptance 8)', async () => {
    const syncRunId = randomUUID();
    const { connector } = recordedConnector([
      {
        rows: [variantRow(1), variantRow(2)],
        nextCursor: 'next-page',
        complete: false,
      },
    ]);
    await installProductTrigger('product-1');
    await expect(
      runCatalogSyncEngine(engineInput(connector, syncRunId)),
    ).rejects.toThrow();
    await dropProductTrigger();

    const [checkpoint] = await database.db
      .select()
      .from(syncRunCheckpoints)
      .where(eq(syncRunCheckpoints.syncRunId, syncRunId));
    expect(checkpoint?.cursor).toBeNull();
    expect(checkpoint?.pages).toBe(0);
    expect(checkpoint?.status).toBe('failed');
  });

  it('handles an empty catalog safely and deactivates stale offers (acceptance 10)', async () => {
    await importCatalog(database.db, {
      schemaVersion: 1,
      runId: randomUUID(),
      merchantId,
      connectionId,
      observedAt: '2026-09-19T08:00:00.000Z',
      rows: [variantRow(9_999)],
    } satisfies ImportJob);

    const { connector } = recordedConnector([
      { rows: [], nextCursor: null, complete: true },
    ]);
    const result = await runCatalogSyncEngine(
      engineInput(connector, randomUUID()),
    );

    expect(result).toMatchObject({ kind: 'completed', imported: 0 });
    expect(await tableCount(products)).toBe(1);
    const [offer] = await database.db
      .select({ active: offers.active })
      .from(offers);
    expect(offer?.active).toBe(false);
    const [checkpoint] = await database.db
      .select()
      .from(syncRunCheckpoints)
      .where(eq(syncRunCheckpoints.connectionId, connectionId));
    expect(checkpoint).toMatchObject({
      status: 'completed',
      pages: 1,
      chunks: 0,
      rowsProcessed: 0,
      sourceComplete: true,
    });
  });

  it('skips a second full sync for the same connection while one is live (acceptance 13)', async () => {
    const liveRunId = randomUUID();
    const begin: BeginSyncRunResult = await beginSyncRun(database.db, {
      merchantId,
      connectionId,
      syncRunId: liveRunId,
      desiredObservedAt: new Date(),
      startedAt: new Date(),
      now: new Date(),
    });
    expect(begin.kind).toBe('started');

    const { connector } = recordedConnector([
      { rows: [variantRow(1)], nextCursor: null, complete: true },
    ]);
    const result = await runCatalogSyncEngine(
      engineInput(connector, randomUUID()),
    );
    expect(result).toEqual({
      kind: 'skipped',
      reason: 'concurrent-sync',
    });
    expect(await tableCount(products)).toBe(0);
  });

  it('atomically admits one fresh run and one attempt per run ID', async () => {
    const now = new Date();
    const firstId = randomUUID();
    const secondId = randomUUID();
    const input = (syncRunId: string) => ({
      merchantId,
      connectionId,
      syncRunId,
      desiredObservedAt: now,
      startedAt: now,
      now,
    });
    const results = await Promise.all([
      beginSyncRun(database.db, input(firstId)),
      beginSyncRun(database.db, input(secondId)),
    ]);
    expect(results.filter((result) => result.kind === 'started')).toHaveLength(
      1,
    );
    expect(
      results.filter((result) => result.kind === 'skipped-concurrent'),
    ).toHaveLength(1);
    const winnerId = results[0]?.kind === 'started' ? firstId : secondId;
    expect(await beginSyncRun(database.db, input(winnerId))).toEqual({
      kind: 'skipped-concurrent',
    });
  });

  it('fences a stale attempt after takeover, including the same run ID', async () => {
    const firstId = randomUUID();
    const secondId = randomUUID();
    const now = new Date();
    const input = (syncRunId: string) => ({
      merchantId,
      connectionId,
      syncRunId,
      desiredObservedAt: now,
      startedAt: now,
      now,
    });
    const first = await beginSyncRun(database.db, input(firstId));
    expect(first.kind).toBe('started');
    if (first.kind !== 'started') throw new Error('unreachable');
    await database.db
      .update(syncConnectionLeases)
      .set({ leaseExpiresAt: new Date(now.getTime() - 1) })
      .where(eq(syncConnectionLeases.connectionId, connectionId));
    const resumed = await beginSyncRun(database.db, input(firstId));
    expect(resumed.kind).toBe('resumed');
    if (resumed.kind !== 'resumed') throw new Error('unreachable');
    expect(resumed.lease.fencingToken).toBe(first.lease.fencingToken + 1);
    await expect(
      writeConnectionSyncProgress(
        database.db,
        merchantId,
        connectionId,
        {
          status: 'running',
          foundProducts: 0,
          processedProducts: 0,
          failedProducts: 0,
          variants: 0,
        },
        now,
        { syncRunId: firstId, fencingToken: first.lease.fencingToken },
      ),
    ).rejects.toBeInstanceOf(SyncLeaseLostError);
    await markSyncRunFailed(database.db, {
      merchantId,
      connectionId,
      syncRunId: firstId,
      error: 'Old attempt failed after takeover',
      fencingToken: first.lease.fencingToken,
      now,
    });
    const [stillRunning] = await database.db
      .select()
      .from(syncRunCheckpoints)
      .where(eq(syncRunCheckpoints.syncRunId, firstId));
    expect(stillRunning?.status).toBe('running');
    await database.db
      .update(syncConnectionLeases)
      .set({ leaseExpiresAt: new Date(now.getTime() - 1) })
      .where(eq(syncConnectionLeases.connectionId, connectionId));
    const takeover = await beginSyncRun(database.db, input(secondId));
    expect(takeover.kind).toBe('started');
    await expect(
      importCatalog(
        database.db,
        {
          schemaVersion: 1,
          runId: firstId,
          merchantId,
          connectionId,
          observedAt: now.toISOString(),
          rows: [variantRow(1)],
        },
        {
          finalizeRun: false,
          syncLease: { fencingToken: resumed.lease.fencingToken, now },
        },
      ),
    ).rejects.toBeInstanceOf(SyncLeaseLostError);
    expect(await tableCount(products)).toBe(0);
    await expect(
      database.db.transaction(async (tx) => {
        await upsertSyncCheckpoint(tx, {
          merchantId,
          connectionId,
          syncRunId: firstId,
          state: first.state,
          observedAt: first.observedAt,
          startedAt: first.startedAt,
          fencingToken: resumed.lease.fencingToken,
          now,
        });
      }),
    ).rejects.toBeInstanceOf(SyncLeaseLostError);
    const [checkpoint] = await database.db
      .select()
      .from(syncRunCheckpoints)
      .where(eq(syncRunCheckpoints.syncRunId, firstId));
    expect(checkpoint?.status).toBe('failed');
  });

  it('returns reference-only results and never surfaces catalog payloads (acceptance 11, 12)', async () => {
    const syncRunId = randomUUID();
    const { connector } = recordedConnector([
      { rows: [variantRow(1)], nextCursor: null, complete: true },
    ]);
    const result = await syncCatalogConnection(
      database.db,
      { merchantId, connectionId, syncRunId },
      { resolve: async () => ({}) },
      () => connector,
    );
    const serialized = JSON.stringify(result ?? {});
    expect(serialized).not.toContain('variant-1');
    expect(serialized).not.toContain('secret://');
    expect(result).toMatchObject({
      skipped: false,
      imported: 1,
      complete: true,
      syncRunId,
    });
  });
});
