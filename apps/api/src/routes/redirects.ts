import { RedirectTokenError } from '@shopai/commerce';
import type { FastifyInstance } from 'fastify';
import type { Services } from '../services.js';

function firstHeader(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export async function registerRedirectRoutes(
  app: FastifyInstance,
  services: Services,
) {
  app.get('/r/:token', async (request, reply) => {
    const { token } = request.params as { token: string };
    try {
      const resolved = await services.redirects.open(token, {
        userAgent: request.headers['user-agent'],
        purpose: firstHeader(request.headers.purpose),
        secPurpose: firstHeader(request.headers['sec-purpose']),
      });
      if (!resolved)
        return reply.code(404).send({
          code: 'OFFER_UNAVAILABLE',
          message: 'Ürün bağlantısı artık kullanılamıyor.',
        });
      return reply.redirect(resolved.url, 302);
    } catch (error) {
      if (error instanceof RedirectTokenError)
        return reply.code(error.code === 'EXPIRED_TOKEN' ? 410 : 400).send({
          code: error.code,
          message: error.message,
        });
      throw error;
    }
  });
}
