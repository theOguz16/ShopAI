import { readConnectionSyncProgress } from '@shopai/db';
import type { FastifyInstance } from 'fastify';

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export async function registerSyncStatusRoutes(app: FastifyInstance) {
  app.get(
    '/v1/connections/:connectionId/sync-status',
    async (request, reply) => {
      if (!request.auth)
        return reply.code(401).send({ code: 'UNAUTHENTICATED' });
      const db = app.authApi.db;
      if (!db) return reply.code(503).send({ code: 'SYNC_STATUS_UNAVAILABLE' });
      const { connectionId } = request.params as { connectionId: string };
      if (!uuid.test(connectionId))
        return reply.code(404).send({ code: 'CONNECTION_NOT_FOUND' });

      const merchants = await app.authApi.listMerchants(request);
      for (const merchant of merchants) {
        const progress = await readConnectionSyncProgress(
          db,
          merchant.id,
          connectionId,
        );
        if (progress) return progress;
      }
      return reply.code(404).send({ code: 'CONNECTION_NOT_FOUND' });
    },
  );
}
