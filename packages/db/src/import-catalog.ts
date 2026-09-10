import {
  normalizeCategory,
  normalizeColor,
  normalizeSize,
} from '@shopai/commerce';
import { type ImportJob, importJobSchema } from '@shopai/contracts';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { Database } from './client.js';
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
    const processedProductKeys = new Set<string>();
    let processedRows = 0;
    for (const row of job.rows) {
      const productData = {
        title: row.title,
        description: row.description,
        category: normalizeCategory(row.category),
        imageUrl: row.imageUrl ?? null,
        imageAlt: row.imageAlt ?? null,
        observedAt,
        fetchedAt,
      };
      await tx
        .insert(products)
        .values({
          ...productData,
          merchantId: job.merchantId,
          connectionId: job.connectionId,
          externalKey: row.productKey,
        })
        .onConflictDoUpdate({
          target: [products.connectionId, products.externalKey],
          set: productData,
          setWhere: sql`${products.observedAt} <= ${observedAt}`,
        });
      const [product] = await tx
        .select({ id: products.id })
        .from(products)
        .where(
          and(
            eq(products.connectionId, job.connectionId),
            eq(products.externalKey, row.productKey),
          ),
        );
      if (!product) throw new Error('Ürün yazılamadı.');
      const variantData = {
        productId: product.id,
        size: normalizeSize(row.size),
        color: normalizeColor(row.color),
        observedAt,
        fetchedAt,
      };
      await tx
        .insert(variants)
        .values({
          ...variantData,
          merchantId: job.merchantId,
          connectionId: job.connectionId,
          externalId: row.externalId,
        })
        .onConflictDoUpdate({
          target: [variants.connectionId, variants.externalId],
          set: variantData,
          setWhere: sql`${variants.observedAt} <= ${observedAt}`,
        });
      const [variant] = await tx
        .select({ id: variants.id })
        .from(variants)
        .where(
          and(
            eq(variants.connectionId, job.connectionId),
            eq(variants.externalId, row.externalId),
          ),
        );
      if (!variant) throw new Error('Varyant yazılamadı.');
      const offerData = {
        variantId: variant.id,
        priceMinor: row.priceMinor,
        currency: row.currency,
        checkoutUrl: row.checkoutUrl,
        observedAt,
        fetchedAt,
      };
      await tx
        .insert(offers)
        .values({
          ...offerData,
          merchantId: job.merchantId,
          connectionId: job.connectionId,
          externalId: row.externalId,
        })
        .onConflictDoUpdate({
          target: [offers.connectionId, offers.externalId],
          set: offerData,
          setWhere: sql`${offers.observedAt} <= ${observedAt}`,
        });
      const [offer] = await tx
        .select({ id: offers.id })
        .from(offers)
        .where(
          and(
            eq(offers.connectionId, job.connectionId),
            eq(offers.externalId, row.externalId),
          ),
        );
      if (!offer) throw new Error('Teklif yazılamadı.');
      await tx
        .insert(inventory)
        .values({
          merchantId: job.merchantId,
          offerId: offer.id,
          available: row.available,
          observedAt,
          fetchedAt,
        })
        .onConflictDoUpdate({
          target: inventory.offerId,
          set: { available: row.available, observedAt, fetchedAt },
          setWhere: sql`${inventory.observedAt} <= ${observedAt}`,
        });
      processedRows += 1;
      processedProductKeys.add(row.productKey);
      if (
        options.onProgress &&
        (processedRows % 100 === 0 || processedRows === job.rows.length)
      )
        await options.onProgress({
          processedRows,
          processedProducts: processedProductKeys.size,
        });
    }
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
      normalizeCategory(row.category),
    ]);
    const existing = productsByKey.get(row.productKey);
    if (existing && existing !== identity)
      throw new Error(
        `Aynı productKey için çelişkili ürün bilgisi: ${row.productKey}`,
      );
    productsByKey.set(row.productKey, identity);
  }
}
