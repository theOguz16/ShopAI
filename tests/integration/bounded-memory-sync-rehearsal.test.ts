import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { runCatalogSyncEngine } from '../../apps/worker/src/catalog-sync-engine.js';
import type { LiveCatalogConnector } from '../../packages/connectors/src/index.js';
import type { SourceRow } from '../../packages/contracts/src/index.js';
import {
  connections,
  connectionSyncProgress,
  createDatabase,
  importRuns,
  inventory,
  merchantCredentialOwnerships,
  merchants,
  offers,
  products,
  sourceCategoryMappings,
  syncRunCheckpoints,
  variants,
} from '../../packages/db/src/index.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl)
  throw new Error('bounded-memory rehearsal için DATABASE_URL gerekli.');

const database = createDatabase(databaseUrl, {
  applicationName: 'shopai-bounded-memory-rehearsal',
});
const merchantId = 'cc000000-0000-4000-8000-000000000001';
const connectionId = 'cc000000-0000-4000-8000-000000000002';
const CREDENTIALS_REF = 'secret://REHEARSAL_TEST';

const PRODUCT_COUNT = 50_000;
const VARIANTS_PER_PRODUCT = 2;
const ROW_COUNT = PRODUCT_COUNT * VARIANTS_PER_PRODUCT; // 100.000
const PAGE_ROWS = 500;
const PAGE_COUNT = ROW_COUNT / PAGE_ROWS; // 200

/**
 * Generator-backed paged source: rows are produced lazily per page. The
 * fixture itself never materializes the catalog, so the rehearsal measures
 * the pipeline, not the fixture.
 */
function generatorConnector(events: string[]) {
  const makeRow = (index: number): SourceRow => {
    const product = Math.ceil(index / VARIANTS_PER_PRODUCT);
    return {
      externalId: `rehearsal-variant-${index}`,
      productKey: `rehearsal-product-${product}`,
      title: `Rehearsal Ürün ${product}`,
      description: 'ÜRÜN-007 bounded-memory rehearsal item',
      category: product % 3 === 0 ? 'fishing-rod' : 'tshirt',
      sourceCategoryId: product % 3 === 0 ? 'src-rod' : 'src-tshirt',
      sourceCategoryPath: product % 3 === 0 ? ['Balıkçılık'] : ['Giyim'],
      imageUrl: `https://images.rehearsal.invalid/p/${product}.jpg`,
      imageAlt: `Rehearsal ${product}`,
      size: ['S', 'M', 'L', 'XL'][index % 4] as string,
      color: ['black', 'blue', 'red', 'green'][index % 4] as string,
      priceMinor: 10_000 + (index % 90_000),
      currency: 'TRY',
      available: index % 11 !== 0,
      checkoutUrl: `https://checkout.rehearsal.invalid/${index}`,
      productAttributes: [
        {
          key: 'material',
          label: 'Malzeme',
          value: product % 2 ? 'pamuk' : 'karbon',
          sourceKey: 'Malzeme',
        },
      ],
      variantOptions: [
        {
          key: 'size',
          label: 'Beden',
          value: ['S', 'M', 'L', 'XL'][index % 4] as string,
          sourceKey: 'Beden',
        },
      ],
    };
  };
  return {
    provider: 'woocommerce',
    capabilities: { liveInventory: true, incrementalSync: true },
    validate: async () => undefined,
    readPage: async ({ cursor }: { cursor?: string | null }) => {
      const page = cursor ? Number(cursor) : 0;
      if (page < 0 || page >= PAGE_COUNT || !Number.isSafeInteger(page))
        throw new Error(`Geçersiz rehearsal sayfası: ${String(cursor)}`);
      const first = page * PAGE_ROWS + 1;
      const rows = Array.from({ length: PAGE_ROWS }, (_, offset) =>
        makeRow(first + offset),
      );
      events.push(`fetch:${page}`);
      return {
        rows,
        nextCursor: page + 1 < PAGE_COUNT ? String(page + 1) : null,
        sourceObservedAt: '2026-09-21T08:00:00.000Z',
        fetchedAt: '2026-09-21T08:01:00.000Z',
        complete: page + 1 >= PAGE_COUNT,
      };
    },
  } satisfies LiveCatalogConnector;
}

beforeEach(async () => {
  await database.db.execute(
    sql`truncate table ${syncRunCheckpoints}, ${connectionSyncProgress}, ${importRuns}, ${inventory}, ${offers}, ${variants}, ${products}, ${sourceCategoryMappings}, ${connections}, ${merchants} cascade`,
  );
  await database.db.insert(merchants).values({
    id: merchantId,
    name: 'Rehearsal Store',
    slug: `rehearsal-${randomUUID()}`,
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
  await database.close();
});

describe.sequential('ÜRÜN-007 large-catalog bounded-memory rehearsal', () => {
  it('imports 50k products / 100k variants with flat memory and lazy paging (acceptance 14)', async () => {
    const events: string[] = [];
    const connector = generatorConnector(events);
    const heapSamples: number[] = [];
    let lastCommittedPageChunks = 0;

    const result = await runCatalogSyncEngine({
      db: database.db,
      job: { merchantId, connectionId },
      syncRunId: randomUUID(),
      connector,
      mode: 'full',
      modifiedAfter: null,
      credentialsRef: CREDENTIALS_REF,
      batchSize: 1_000,
      onChunkCommitted: (info) => {
        // Architectural assertion: page k+1 is fetched only after every
        // chunk of page k committed — no look-ahead, natural backpressure.
        const page = Math.ceil(info.rowsProcessed / PAGE_ROWS) - 1;
        if (page + 1 < PAGE_COUNT && events.includes(`fetch:${page + 1}`)) {
          throw new Error(
            `Sayfa ${page + 1} commit'ten önce fetch edildi (look-ahead).`,
          );
        }
        events.push(`commit:${page}`);
        lastCommittedPageChunks = info.chunks;
        heapSamples.push(process.memoryUsage().heapUsed);
      },
    });

    expect(result).toMatchObject({
      kind: 'completed',
      imported: ROW_COUNT,
      mode: 'full',
    });
    expect(lastCommittedPageChunks).toBe(PAGE_COUNT);
    // Strict pipelining: each fetch of page k happens after the previous
    // page's commits (single page in flight, at most).
    let lastCommitIndex = -1;
    let lastFetchIndex = -1;
    for (let i = 0; i < events.length; i += 1) {
      const [kind, pageRaw] = events[i].split(':');
      const page = Number(pageRaw);
      if (kind === 'fetch') {
        expect(page).toBe(lastFetchIndex + 1);
        if (lastFetchIndex >= 0)
          expect(lastCommitIndex).toBeGreaterThan(
            events.indexOf(`fetch:${lastFetchIndex}`),
          );
        lastFetchIndex = page;
      } else {
        expect(page).toBeLessThanOrEqual(lastFetchIndex);
        lastCommitIndex = i;
      }
    }
    expect(lastFetchIndex).toBe(PAGE_COUNT - 1);

    // Exact results, no duplicates.
    expect(result.kind === 'completed' ? result.counters : null).toMatchObject({
      pages: PAGE_COUNT,
      chunks: PAGE_COUNT,
      rowsProcessed: ROW_COUNT,
      productsProcessed: PRODUCT_COUNT,
      variantsProcessed: ROW_COUNT,
      sourceComplete: true,
      cursor: null,
    });
    const [productTotal] = await database.db
      .select({ value: sql<number>`count(*)::integer` })
      .from(products);
    expect(productTotal?.value).toBe(PRODUCT_COUNT);
    const [productDistinct] = await database.db
      .select({
        value: sql<number>`count(distinct ${products.externalKey})::integer`,
      })
      .from(products);
    expect(productDistinct?.value).toBe(PRODUCT_COUNT);
    const [variantTotal] = await database.db
      .select({ value: sql<number>`count(*)::integer` })
      .from(variants);
    expect(variantTotal?.value).toBe(ROW_COUNT);
    const [offerTotal] = await database.db
      .select({ value: sql<number>`count(*)::integer` })
      .from(offers);
    expect(offerTotal?.value).toBe(ROW_COUNT);
    const [inventoryTotal] = await database.db
      .select({ value: sql<number>`count(*)::integer` })
      .from(inventory);
    expect(inventoryTotal?.value).toBe(ROW_COUNT);
    const [mappingTotal] = await database.db
      .select({ value: sql<number>`count(*)::integer` })
      .from(sourceCategoryMappings);
    expect(mappingTotal?.value).toBe(2);

    // Spot-check first and last page rows survived intact.
    const [firstVariant] = await database.db
      .select()
      .from(variants)
      .where(eq(variants.externalId, 'rehearsal-variant-1'));
    expect(firstVariant?.size).toBe('M');
    const [lastOffer] = await database.db
      .select()
      .from(offers)
      .where(eq(offers.externalId, `rehearsal-variant-${ROW_COUNT}`));
    expect(lastOffer?.priceMinor).toBe(10_000 + (ROW_COUNT % 90_000));

    // Peak working-set evidence (deliberately generous; the pipeline must
    // not grow with catalog size). V8's heap is a GC sawtooth, so the
    // decisive metric is the low-water (post-GC steady state) drift between
    // the first and last quarter of the run — linear materialization would
    // push the low-water mark up as the catalog streams through.
    const samples = heapSamples.slice(10);
    expect(samples.length).toBeGreaterThan(150);
    const quarter = Math.floor(samples.length / 4);
    const minOf = (values: number[]) => Math.min(...values);
    const lowWaterDrift =
      minOf(samples.slice(-quarter)) - minOf(samples.slice(0, quarter));
    expect(lowWaterDrift).toBeLessThan(64 * 1024 * 1024);
    const band = Math.max(...samples) - minOf(samples);
    expect(band).toBeLessThan(256 * 1024 * 1024);
    console.info(
      `bounded-memory rehearsal: ${ROW_COUNT} rows in ${PAGE_COUNT} pages; low-water drift ${(lowWaterDrift / 1048576).toFixed(1)}MB; heap band ${(band / 1048576).toFixed(1)}MB; samples ${samples.length}`,
    );
    const finalHeap = process.memoryUsage().heapUsed;
    expect(finalHeap).toBeLessThan(heapSamples[0] + 512 * 1024 * 1024);

    const [checkpoint] = await database.db
      .select()
      .from(syncRunCheckpoints)
      .where(eq(syncRunCheckpoints.connectionId, connectionId));
    expect(checkpoint).toMatchObject({
      status: 'completed',
      pages: PAGE_COUNT,
      chunks: PAGE_COUNT,
      rowsProcessed: ROW_COUNT,
    });
  }, 300_000);
});
