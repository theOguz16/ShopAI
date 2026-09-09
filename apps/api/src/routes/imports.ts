import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import {
  connections,
  importOutboxEvents,
  importRuns,
  setTenantContext,
} from '@shopai/db';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ApiEnv } from '../env.js';
import { requireRole, requireSameOrigin } from '../plugins/auth.js';

const CSV_TYPES = new Set([
  'text/csv',
  'application/csv',
  'application/octet-stream',
]);

export async function requeueFailedImport(
  db: NonNullable<FastifyInstance['authApi']['db']>,
  merchantId: string,
  runId: string,
) {
  return db.transaction(async (tx) => {
    await setTenantContext(tx, merchantId);
    const [run] = await tx
      .select({
        id: importRuns.id,
        status: importRuns.status,
        connectionId: importRuns.connectionId,
        filePath: importRuns.filePath,
      })
      .from(importRuns)
      .where(
        and(eq(importRuns.id, runId), eq(importRuns.merchantId, merchantId)),
      );
    if (run?.status !== 'failed')
      throw new Error('Yalnız başarısız işler yeniden denenebilir.');
    const dispatchId = randomUUID();
    await tx
      .update(importRuns)
      .set({ status: 'pending', error: null, completedAt: null })
      .where(eq(importRuns.id, runId));
    const [event] = await tx
      .update(importOutboxEvents)
      .set({
        payload: {
          runId,
          dispatchId,
          merchantId,
          connectionId: run.connectionId,
          filePath: run.filePath,
        },
        publishedAt: null,
        availableAt: new Date(),
        attempts: 0,
      })
      .where(
        and(
          eq(importOutboxEvents.runId, runId),
          eq(importOutboxEvents.merchantId, merchantId),
        ),
      )
      .returning({ id: importOutboxEvents.id });
    if (!event) throw new Error('Import outbox olayı bulunamadı.');
    return { dispatchId };
  });
}

export async function registerImportRoutes(app: FastifyInstance, env: ApiEnv) {
  await mkdir(env.UPLOAD_DIR, { recursive: true });
  app.post(
    '/v1/merchants/:merchantId/imports',
    { preHandler: [requireSameOrigin, requireRole('owner', 'editor')] },
    async (request, reply) => {
      const db = app.authApi.db;
      if (!db) return reply.code(503).send({ code: 'IMPORT_UNAVAILABLE' });
      const { merchantId } = request.params as { merchantId: string };
      const contentType =
        String(request.headers['content-type'] ?? '').split(';')[0] ?? '';
      if (!CSV_TYPES.has(contentType))
        return reply.code(415).send({ code: 'CSV_REQUIRED' });
      const content =
        typeof request.body === 'string'
          ? request.body
          : Buffer.isBuffer(request.body)
            ? request.body.toString('utf8')
            : '';
      if (!content || Buffer.byteLength(content, 'utf8') > 2 * 1024 * 1024)
        return reply.code(413).send({ code: 'CSV_TOO_LARGE' });
      const connection = await db.transaction(async (tx) => {
        await setTenantContext(tx, merchantId);
        const [existing] = await tx
          .select({ id: connections.id })
          .from(connections)
          .where(
            and(
              eq(connections.merchantId, merchantId),
              eq(connections.provider, 'csv'),
              eq(connections.active, true),
            ),
          )
          .limit(1);
        if (existing) return existing;
        const [created] = await tx
          .insert(connections)
          .values({
            merchantId,
            provider: 'csv',
            credentialsRef: null,
            syncMode: 'full',
            authorizationStatus: 'active',
            conversionTrackingEnabled: false,
          })
          .returning({ id: connections.id });
        if (!created) throw new Error('CSV bağlantısı oluşturulamadı.');
        return created;
      });
      const runId = randomUUID();
      const dispatchId = randomUUID();
      const filePath = `${env.UPLOAD_DIR}/${runId}.csv`;
      await writeFile(filePath, content, { encoding: 'utf8', flag: 'wx' });
      try {
        await db.transaction(async (tx) => {
          await setTenantContext(tx, merchantId);
          await tx.insert(importRuns).values({
            id: runId,
            merchantId,
            connectionId: connection.id,
            rows: 0,
            observedAt: new Date(),
            status: 'pending',
            filePath,
          });
          await tx.insert(importOutboxEvents).values({
            id: randomUUID(),
            runId,
            merchantId,
            payload: {
              runId,
              dispatchId,
              merchantId,
              connectionId: connection.id,
              filePath,
            },
          });
        });
      } catch (error) {
        await unlink(filePath).catch(() => undefined);
        throw error;
      }
      request.log.info(
        {
          event: 'import_accepted',
          requestId: request.id,
          importRunId: runId,
          merchantId,
          connectionId: connection.id,
        },
        'Import accepted',
      );
      return reply.code(202).send({ runId, status: 'pending' });
    },
  );
  app.get(
    '/v1/merchants/:merchantId/imports',
    { preHandler: requireRole('owner', 'editor', 'viewer') },
    async (request) => {
      const db = app.authApi.db;
      if (!db) return [];
      const { merchantId } = request.params as { merchantId: string };
      return db.transaction(async (tx) => {
        await setTenantContext(tx, merchantId);
        return tx
          .select({
            id: importRuns.id,
            status: importRuns.status,
            rows: importRuns.rows,
            error: importRuns.error,
            createdAt: importRuns.observedAt,
            completedAt: importRuns.completedAt,
          })
          .from(importRuns)
          .where(eq(importRuns.merchantId, merchantId))
          .orderBy(importRuns.observedAt);
      });
    },
  );
  app.post(
    '/v1/merchants/:merchantId/imports/:runId/retry',
    { preHandler: [requireSameOrigin, requireRole('owner', 'editor')] },
    async (request, reply) => {
      const db = app.authApi.db;
      if (!db) return reply.code(503).send({ code: 'IMPORT_UNAVAILABLE' });
      const { merchantId, runId } = request.params as {
        merchantId: string;
        runId: string;
      };
      await requeueFailedImport(db, merchantId, runId);
      return reply.code(202).send({ runId, status: 'pending' });
    },
  );
}
