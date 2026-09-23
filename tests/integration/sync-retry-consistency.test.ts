import { randomUUID } from 'node:crypto';
import { count, eq, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
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
  inventory,
  merchantCredentialOwnerships,
  merchants,
  offers,
  products,
  variants,
} from '../../packages/db/src/index.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl)
  throw new Error('sync-retry-consistency.test için DATABASE_URL gerekli.');

const database = createDatabase(databaseUrl, {
  applicationName: 'shopai-sync-retry-consistency',
});
const merchantId = 'cf000000-0000-4000-8000-000000000001';
const connectionId = 'cf000000-0000-4000-8000-000000000002';

function sourceRow(index: number): SourceRow {
  return {
    externalId: `variant-${index}`,
    productKey: `product-${index}`,
    title: `Ürün ${index}`,
    description: 'Controlled retry fixture',
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

const snapshotRows = Array.from({ length: 1_200 }, (_, index) =>
  sourceRow(index + 1),
);

function connector(readCursors: Array<string | null>): LiveCatalogConnector {
  return {
    provider: 'woocommerce',
    capabilities: { liveInventory: true, incrementalSync: true },
    validate: async () => undefined,
    readPage: async ({ cursor }) => {
      readCursors.push(cursor);
      return {
        rows: snapshotRows,
        nextCursor: null,
        sourceObservedAt: '2026-09-17T08:00:00.000Z',
        fetchedAt: '2026-09-17T08:01:00.000Z',
        complete: true,
      };
    },
  };
}

async function tableCount(table: typeof products | typeof offers) {
  const [row] = await database.db.select({ value: count() }).from(table);
  return row?.value ?? 0;
}

beforeEach(async () => {
  await database.db.execute(sql`
    DROP TRIGGER IF EXISTS fail_controlled_sync_product ON products;
    DROP FUNCTION IF EXISTS fail_controlled_sync_product();
  `);
  await database.db.execute(
    sql`truncate table ${connectionSyncProgress}, ${inventory}, ${offers}, ${variants}, ${products}, ${connections}, ${merchants} cascade`,
  );
  await database.db.insert(merchants).values({
    id: merchantId,
    name: 'Retry Store',
    slug: `retry-${randomUUID()}`,
    active: true,
    isPublic: true,
  });
  await database.db.insert(connections).values({
    id: connectionId,
    merchantId,
    provider: 'woocommerce',
    credentialsRef: 'secret://RETRY_TEST',
    authorizationStatus: 'active',
    syncMode: 'full',
  });
  await database.db.insert(merchantCredentialOwnerships).values({
    merchantId,
    provider: 'woocommerce',
    credentialsRef: 'secret://RETRY_TEST',
  });
  await importCatalog(database.db, {
    schemaVersion: 1,
    runId: randomUUID(),
    merchantId,
    connectionId,
    observedAt: '2026-09-16T08:00:00.000Z',
    rows: [
      {
        ...sourceRow(9_999),
        externalId: 'legacy-variant',
        productKey: 'legacy-product',
      },
    ],
  } satisfies ImportJob);
});

afterAll(async () => {
  await database.db.execute(sql`
    DROP TRIGGER IF EXISTS fail_controlled_sync_product ON products;
    DROP FUNCTION IF EXISTS fail_controlled_sync_product();
  `);
  await database.close();
});

describe.sequential('catalog sync commit-aware progress and retry', () => {
  it('keeps counters at committed batches and retries idempotently from the beginning', async () => {
    await database.db.execute(sql`
      CREATE FUNCTION fail_controlled_sync_product() RETURNS trigger AS $$
      BEGIN
        IF NEW.external_key = 'product-1150' THEN
          RAISE EXCEPTION 'controlled second batch failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER fail_controlled_sync_product
      BEFORE INSERT OR UPDATE ON products
      FOR EACH ROW EXECUTE FUNCTION fail_controlled_sync_product();
    `);

    const firstAttemptCursors: Array<string | null> = [];
    await expect(
      syncCatalogConnection(
        database.db,
        { merchantId, connectionId },
        { resolve: async () => ({}) },
        () => connector(firstAttemptCursors),
      ),
    ).rejects.toThrow('Catalog sync failed');

    const [failedProgress] = await database.db
      .select()
      .from(connectionSyncProgress)
      .where(eq(connectionSyncProgress.connectionId, connectionId));
    expect(firstAttemptCursors).toEqual([null]);
    expect(failedProgress).toMatchObject({
      status: 'partial',
      foundProducts: 1_200,
      processedProducts: 1_000,
      failedProducts: 200,
      variants: 1_200,
    });
    expect(await tableCount(products)).toBe(1_001);
    expect(await tableCount(offers)).toBe(1_001);
    const [legacyAfterFailure] = await database.db
      .select({ active: offers.active })
      .from(offers)
      .where(eq(offers.externalId, 'legacy-variant'));
    expect(legacyAfterFailure?.active).toBe(true);

    await database.db.execute(sql`
      DROP TRIGGER fail_controlled_sync_product ON products;
      DROP FUNCTION fail_controlled_sync_product();
    `);
    const retryCursors: Array<string | null> = [];
    await expect(
      syncCatalogConnection(
        database.db,
        { merchantId, connectionId },
        { resolve: async () => ({}) },
        () => connector(retryCursors),
      ),
    ).resolves.toMatchObject({
      skipped: false,
      imported: 1_200,
      progress: {
        status: 'completed',
        foundProducts: 1_200,
        processedProducts: 1_200,
        failedProducts: 0,
      },
    });

    const [completedProgress] = await database.db
      .select()
      .from(connectionSyncProgress)
      .where(eq(connectionSyncProgress.connectionId, connectionId));
    expect(retryCursors).toEqual([null]);
    expect(completedProgress).toMatchObject({
      status: 'completed',
      foundProducts: 1_200,
      processedProducts: 1_200,
      failedProducts: 0,
      variants: 1_200,
    });
    expect(await tableCount(products)).toBe(1_201);
    expect(await tableCount(offers)).toBe(1_201);
    const [legacyAfterSuccess] = await database.db
      .select({ active: offers.active })
      .from(offers)
      .where(eq(offers.externalId, 'legacy-variant'));
    expect(legacyAfterSuccess?.active).toBe(false);
  });
});
