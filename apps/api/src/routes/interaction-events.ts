import {
  interactionEventsRequestSchema,
  interactionEventsResponseSchema,
} from '@shopai/contracts';
import type { FastifyInstance } from 'fastify';
import { requireSameOrigin } from '../plugins/auth.js';
import type { Services } from '../services.js';

export async function registerInteractionEventRoutes(
  app: FastifyInstance,
  services: Services,
) {
  app.post(
    '/v1/interaction-events',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      preHandler: requireSameOrigin,
    },
    async (request, reply) => {
      const parsed = interactionEventsRequestSchema.safeParse(request.body);
      if (!parsed.success)
        return reply
          .code(400)
          .send({ code: 'INVALID_INPUT', requestId: request.id });
      const attribution = await services.resolveRestAttribution(parsed.data);
      const result = await services.recordInteractionEvents(
        parsed.data,
        attribution,
      );
      return reply
        .code(202)
        .send(interactionEventsResponseSchema.parse(result));
    },
  );
}
