import { importJobSchema } from '@shopai/contracts';
import {
  importCatalog,
  importRuns,
  setTenantContext,
  type Database,
} from '@shopai/db';
import { readFile } from 'node:fs/promises';
import { eq } from 'drizzle-orm';
import { parseCatalogCsv } from '@shopai/connectors';

export function processImportJob(db: Database, name: string, data: unknown) {
  if (name !== 'csv-import') throw new Error('Bilinmeyen iş türü.');
  return importCatalog(db, importJobSchema.parse(data));
}

export async function processImportReference(db: Database, data: unknown) {
  const reference = data as {
    runId?: string;
    merchantId?: string;
    connectionId?: string;
    filePath?: string;
  };
  if (
    !reference.runId ||
    !reference.merchantId ||
    !reference.connectionId ||
    !reference.filePath
  )
    throw new Error('Eksik import referansı.');
  const { runId, merchantId, connectionId, filePath } = reference as {
    runId: string;
    merchantId: string;
    connectionId: string;
    filePath: string;
  };
  type RunUpdate = Pick<
    typeof importRuns.$inferInsert,
    'status' | 'error' | 'completedAt'
  >;
  const updateRun = async (values: RunUpdate) =>
    db.transaction(async (tx) => {
      await setTenantContext(tx, merchantId);
      await tx.update(importRuns).set(values).where(eq(importRuns.id, runId));
    });
  await updateRun({ status: 'validating' });
  try {
    const parsed = parseCatalogCsv(await readFile(filePath, 'utf8'));
    if (parsed.errors.length) {
      await updateRun({
        status: 'failed',
        error: { rows: parsed.errors },
        completedAt: new Date(),
      });
      return { failed: true, errors: parsed.errors };
    }
    return importCatalog(db, {
      schemaVersion: 1,
      runId,
      merchantId,
      connectionId,
      observedAt: new Date().toISOString(),
      rows: parsed.rows,
    });
  } catch (error) {
    await updateRun({
      status: 'failed',
      error: {
        message: error instanceof Error ? error.message : 'Bilinmeyen hata',
      },
      completedAt: new Date(),
    });
    throw error;
  }
}
