import {
  normalizeCategory,
  normalizeColor,
  normalizeSize,
} from '@shopai/commerce';
import {
  type ImportJob,
  importJobSchema,
  canonicalCatalogAttributes,
  type SourceRow,
} from '@shopai/contracts';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from './client.js';
import { sourceCategoryMappings } from './category-model.js';
import {
  connections,
  importRuns,
  inventory,
  offers,
  products,
  variants,
} from './schema.js';
import { setTenantContext } from './tenant-context.js';

export type ImportCatalogProgress = {
  processedRows: number;
  processedProducts: number;
};

type ImportCatalogOptions = {
  onProgress?: (progress: ImportCatalogProgress) => Promise<void> | void;
  /**
   * Default true: the job owns its import_runs row end to end (CSV path).
   * Chunked sync runs pass false and let the sync run finalizer keep the
   * cumulative run record.
   */
  finalizeRun?: boolean;
};

/** Trusted local CLI/worker only. New products always remain unpublished. */
export async function importCatalog(
  db: Database,
  input: ImportJob,
  options: ImportCatalogOptions = {},
) {
  const job = importJobSchema.parse(input);
  const observedAt = new Date(job.observedAt);
  const fetchedAt = new Date();
  assertConsistentProductRows(job);
  return db.transaction(async (tx) => {
    await setTenantContext(tx, job.merchantId);
    // Serialize imports for one connection across worker processes.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${job.connectionId}))`,
    );
    const [connection] = await tx
      .select()
      .from(connections)
      .where(
        and(
          eq(connections.id, job.connectionId),
          eq(connections.merchantId, job.merchantId),
          eq(connections.active, true),
        ),
      );
    if (!connection) throw new Error('Aktif bağlantı bu mağazaya ait değil.');
    if (options.finalizeRun !== false) {
      const [done] = await tx
        .select()
        .from(importRuns)
        .where(eq(importRuns.id, job.runId));
      if (done?.status === 'completed') {
        if (
          done.merchantId !== job.merchantId ||
          done.connectionId !== job.connectionId
        )
          throw new Error('Import kimliği kapsam dışında.');
        return { imported: 0, duplicate: true };
      }
      if (done) {
        await tx
          .update(importRuns)
          .set({ status: 'processing', error: null })
          .where(eq(importRuns.id, job.runId));
      }
      const [latest] = await tx
        .select({ observedAt: importRuns.observedAt })
        .from(importRuns)
        .where(eq(importRuns.connectionId, job.connectionId))
        .orderBy(desc(importRuns.observedAt))
        .limit(1);
      if (latest && latest.observedAt > observedAt) {
        if (done) {
          await tx
            .update(importRuns)
            .set({ status: 'completed', completedAt: new Date() })
            .where(eq(importRuns.id, job.runId));
        } else {
          await tx.insert(importRuns).values({
            id: job.runId,
            merchantId: job.merchantId,
            connectionId: job.connectionId,
            rows: 0,
            observedAt,
            status: 'completed',
            filePath: '',
            completedAt: new Date(),
          });
        }
        return { imported: 0, duplicate: false, stale: true };
      }
    }

    // Chunk-level state only: every structure below is bounded by the
    // configured batch size, never by the catalog size.
    const productDataByKey = new Map<string, typeof products.$inferInsert>();
    const variantDataByExternalId = new Map<
      string,
      Omit<typeof variants.$inferInsert, 'productId'>
    >();
    const offerDataByExternalId = new Map<
      string,
      Omit<typeof offers.$inferInsert, 'variantId' | 'lastSyncRunId'>
    >();
    const availableByExternalId = new Map<string, boolean | null>();
    const categoryRowBySourceId = new Map<
      string,
      typeof sourceCategoryMappings.$inferInsert
    >();
    const productKeyByExternalId = new Map<string, string>();

    for (const row of job.rows) {
      productDataByKey.set(row.productKey, {
        merchantId: job.merchantId,
        connectionId: job.connectionId,
        externalKey: row.productKey,
        title: row.title,
        description: row.description,
        category: normalizeCategory(row.category),
        sourceCategoryName: row.category,
        sourceCategoryProvider: connection.provider,
        sourceCategoryId: row.sourceCategoryId ?? null,
        sourceCategoryPath: row.sourceCategoryPath ?? null,
        descriptiveAttributes: canonicalCatalogAttributes(
          row.productAttributes ?? [],
        ),
        imageUrl: row.imageUrl ?? null,
        imageAlt: row.imageAlt ?? null,
        observedAt,
        fetchedAt,
      });
      if (
        row.sourceCategoryId &&
        !categoryRowBySourceId.has(row.sourceCategoryId)
      ) {
        categoryRowBySourceId.set(row.sourceCategoryId, {
          merchantId: job.merchantId,
          connectionId: job.connectionId,
          provider: connection.provider,
          sourceCategoryId: row.sourceCategoryId,
          sourceCategoryName: row.category,
          sourceCategoryPath: row.sourceCategoryPath ?? null,
          status: 'needs_mapping',
        });
      }
      variantDataByExternalId.set(row.externalId, {
        merchantId: job.merchantId,
        connectionId: job.connectionId,
        externalId: row.externalId,
        size: normalizeSize(row.size ?? 'ONE_SIZE'),
        color: normalizeColor(row.color ?? 'unspecified'),
        options: canonicalCatalogAttributes(optionsForRow(row)),
        imageUrl: row.variantImageUrl ?? null,
        imageAlt: row.variantImageAlt ?? null,
        observedAt,
        fetchedAt,
      });
      offerDataByExternalId.set(row.externalId, {
        merchantId: job.merchantId,
        connectionId: job.connectionId,
        externalId: row.externalId,
        priceMinor: row.priceMinor,
        currency: row.currency,
        checkoutUrl: row.checkoutUrl,
        observedAt,
        fetchedAt,
      });
      availableByExternalId.set(row.externalId, row.available);
      productKeyByExternalId.set(row.externalId, row.productKey);
    }

    if (categoryRowBySourceId.size) {
      // ÜRÜN-006: source provenance is refreshed, canonical mapping state
      // (status/canonical slug) is never overwritten by sync.
      await tx
        .insert(sourceCategoryMappings)
        .values([...categoryRowBySourceId.values()])
        .onConflictDoUpdate({
          target: [
            sourceCategoryMappings.merchantId,
            sourceCategoryMappings.connectionId,
            sourceCategoryMappings.provider,
            sourceCategoryMappings.sourceCategoryId,
          ],
          set: {
            sourceCategoryName: sql`excluded.source_category_name`,
            sourceCategoryPath: sql`excluded.source_category_path`,
          },
        });
    }

    await tx
      .insert(products)
      .values([...productDataByKey.values()])
      .onConflictDoUpdate({
        target: [products.connectionId, products.externalKey],
        set: {
          title: sql`excluded.title`,
          description: sql`excluded.description`,
          category: sql`excluded.category`,
          sourceCategoryName: sql`excluded.source_category_name`,
          sourceCategoryProvider: sql`excluded.source_category_provider`,
          sourceCategoryId: sql`excluded.source_category_id`,
          sourceCategoryPath: sql`excluded.source_category_path`,
          descriptiveAttributes: sql`excluded.descriptive_attributes`,
          imageUrl: sql`excluded.image_url`,
          imageAlt: sql`excluded.image_alt`,
          observedAt: sql`excluded.observed_at`,
          fetchedAt: sql`excluded.fetched_at`,
        },
        setWhere: sql`${products.observedAt} <= excluded.observed_at`,
      });
    const productKeys = [...productDataByKey.keys()];
    const productRows = await tx
      .select({ id: products.id, externalKey: products.externalKey })
      .from(products)
      .where(
        and(
          eq(products.connectionId, job.connectionId),
          inArray(products.externalKey, productKeys),
        ),
      );
    const productIdByKey = new Map(
      productRows.map((row) => [row.externalKey, row.id]),
    );

    const variantValues = [...variantDataByExternalId.entries()].map(
      ([externalId, data]) => {
        const productKey = productKeyByExternalId.get(externalId);
        const productId = productKey
          ? productIdByKey.get(productKey)
          : undefined;
        if (!productId) throw new Error('Ürün yazılamadı.');
        return { ...data, productId } satisfies typeof variants.$inferInsert;
      },
    );
    await tx
      .insert(variants)
      .values(variantValues)
      .onConflictDoUpdate({
        target: [variants.connectionId, variants.externalId],
        set: {
          productId: sql`excluded.product_id`,
          size: sql`excluded.size`,
          color: sql`excluded.color`,
          options: sql`excluded.options`,
          imageUrl: sql`excluded.image_url`,
          imageAlt: sql`excluded.image_alt`,
          observedAt: sql`excluded.observed_at`,
          fetchedAt: sql`excluded.fetched_at`,
        },
        setWhere: sql`${variants.observedAt} <= excluded.observed_at`,
      });
    const variantRows = await tx
      .select({ id: variants.id, externalId: variants.externalId })
      .from(variants)
      .where(
        and(
          eq(variants.connectionId, job.connectionId),
          inArray(
            variants.externalId,
            variantValues.map((row) => row.externalId as string),
          ),
        ),
      );
    const variantIdByExternalId = new Map(
      variantRows.map((row) => [row.externalId, row.id]),
    );

    const offerValues = [...offerDataByExternalId.entries()].map(
      ([externalId, data]) => {
        const variantId = variantIdByExternalId.get(externalId);
        if (!variantId) throw new Error('Varyant yazılamadı.');
        return {
          ...data,
          variantId,
          lastSyncRunId: job.runId,
        } satisfies typeof offers.$inferInsert;
      },
    );
    await tx
      .insert(offers)
      .values(offerValues)
      .onConflictDoUpdate({
        target: [offers.connectionId, offers.externalId],
        set: {
          variantId: sql`excluded.variant_id`,
          priceMinor: sql`excluded.price_minor`,
          currency: sql`excluded.currency`,
          checkoutUrl: sql`excluded.checkout_url`,
          observedAt: sql`excluded.observed_at`,
          fetchedAt: sql`excluded.fetched_at`,
          lastSyncRunId: sql`excluded.last_sync_run_id`,
        },
        setWhere: sql`${offers.observedAt} <= excluded.observed_at`,
      });
    // The guarded update above leaves an older-observed offer's data (and its
    // previous run stamp) untouched even though this run observed it; re-stamp
    // every chunk row so full-sync deactivation never drops snapshot members.
    await tx
      .update(offers)
      .set({ lastSyncRunId: job.runId })
      .where(
        and(
          eq(offers.connectionId, job.connectionId),
          inArray(
            offers.externalId,
            offerValues.map((row) => row.externalId),
          ),
        ),
      );
    const offerRows = await tx
      .select({ id: offers.id, externalId: offers.externalId })
      .from(offers)
      .where(
        and(
          eq(offers.connectionId, job.connectionId),
          inArray(
            offers.externalId,
            offerValues.map((row) => row.externalId),
          ),
        ),
      );
    const offerIdByExternalId = new Map(
      offerRows.map((row) => [row.externalId, row.id]),
    );

    const inventoryValues = [...availableByExternalId.entries()].map(
      ([externalId, available]) => {
        const offerId = offerIdByExternalId.get(externalId);
        if (!offerId) throw new Error('Teklif yazılamadı.');
        return {
          offerId,
          merchantId: job.merchantId,
          available,
          observedAt,
          fetchedAt,
        } satisfies typeof inventory.$inferInsert;
      },
    );
    await tx
      .insert(inventory)
      .values(inventoryValues)
      .onConflictDoUpdate({
        target: inventory.offerId,
        set: {
          available: sql`excluded.available`,
          observedAt: sql`excluded.observed_at`,
          fetchedAt: sql`excluded.fetched_at`,
        },
        setWhere: sql`${inventory.observedAt} <= excluded.observed_at`,
      });

    if (options.finalizeRun !== false) {
      const [done] = await tx
        .select({ id: importRuns.id })
        .from(importRuns)
        .where(eq(importRuns.id, job.runId));
      if (done) {
        await tx
          .update(importRuns)
          .set({
            rows: job.rows.length,
            observedAt,
            status: 'completed',
            completedAt: new Date(),
            error: null,
          })
          .where(eq(importRuns.id, job.runId));
      } else {
        await tx.insert(importRuns).values({
          id: job.runId,
          merchantId: job.merchantId,
          connectionId: job.connectionId,
          rows: job.rows.length,
          observedAt,
          status: 'completed',
          filePath: '',
          completedAt: new Date(),
        });
      }
    }
    if (options.onProgress)
      await options.onProgress({
        processedRows: job.rows.length,
        processedProducts: productDataByKey.size,
      });
    return { imported: job.rows.length, duplicate: false, stale: false };
  });
}

/** A product key is one product identity; presentation fields must agree per job. */
function assertConsistentProductRows(job: ImportJob) {
  const productsByKey = new Map<string, string>();
  const externalIds = new Set<string>();
  for (const row of job.rows) {
    if (externalIds.has(row.externalId))
      throw new Error(
        `Aynı externalId bir importta tekrar edemez: ${row.externalId}`,
      );
    externalIds.add(row.externalId);
    const identity = JSON.stringify([
      row.title.trim(),
      row.description,
      row.category.trim(),
      normalizeCategory(row.category),
      row.sourceCategoryId ?? null,
      row.sourceCategoryPath ?? null,
      canonicalCatalogAttributes(row.productAttributes ?? []),
    ]);
    const existing = productsByKey.get(row.productKey);
    if (existing && existing !== identity)
      throw new Error(
        `Aynı productKey için çelişkili ürün bilgisi: ${row.productKey}`,
      );
    productsByKey.set(row.productKey, identity);
  }
}

function optionsForRow(row: SourceRow) {
  if (row.variantOptions !== undefined) return row.variantOptions;
  const options = [];
  if (row.size && row.size !== 'ONE_SIZE')
    options.push({ key: 'size', value: row.size });
  if (row.color && row.color !== 'unspecified')
    options.push({ key: 'color', value: row.color });
  return options;
}
