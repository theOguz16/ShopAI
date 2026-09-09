import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { searchRequestSchema } from '@shopai/contracts';
import { createDatabase } from '@shopai/db';
import Fastify from 'fastify';
import { type ApiEnv, parseApiEnv } from './env.js';
import { createMcpServer } from './mcp.js';
import { registerAuth, requireSameOrigin } from './plugins/auth.js';
import { registerImportRoutes } from './routes/imports.js';
import { registerMerchantRoutes } from './routes/merchants.js';
import { registerProductRoutes } from './routes/products.js';
import { registerRedirectRoutes } from './routes/redirects.js';
import { registerAnalyticsRoutes } from './routes/analytics.js';
import { registerConversionRoutes } from './routes/conversions.js';
import { createServices, type Services } from './services.js';
export async function buildApp(
  services?: Services,
  env: ApiEnv = parseApiEnv(process.env),
) {
  const resolvedServices = services ?? createServices(env);
  const authDatabase =
    env.CATALOG_MODE === 'postgres'
      ? createDatabase(env.DATABASE_URL)
      : undefined;
  const app = Fastify({
    routerOptions: { maxParamLength: 1024 },
    logger: {
      level: env.LOG_LEVEL,
      redact: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers.x-shopai-signature',
        'req.body.consumerKey',
        'req.body.consumerSecret',
        'req.body.token',
        'req.body.AUTH_PILOT_CREDENTIALS',
      ],
    },
    bodyLimit: 2 * 1024 * 1024 + 16384,
  });
  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });
  app.addHook('onResponse', async (request, reply) => {
    if (
      reply.statusCode >= 500 &&
      (request.url.startsWith('/v1/search') || request.url === '/mcp')
    )
      request.log.error(
        {
          event: 'search_error',
          requestId: request.id,
          release: env.RELEASE_VERSION,
          statusCode: reply.statusCode,
        },
        'Search request failed',
      );
  });
  app.addContentTypeParser(
    ['text/csv', 'application/csv', 'application/octet-stream'],
    { parseAs: 'string' },
    (_request, body, done) => done(null, body),
  );
  await app.register(cors, {
    origin: env.MCP_ALLOWED_ORIGINS,
    credentials: true,
  });
  await app.register(rateLimit, { max: 60, timeWindow: '1 minute' });
  registerAuth(app, authDatabase?.db, env);
  app.post(
    '/v1/auth/login',
    { preHandler: requireSameOrigin },
    async (request, reply) => {
      const body = request.body as { email?: string; token?: string };
      if (!body?.email || !body.token)
        return reply.code(400).send({ code: 'INVALID_INPUT' });
      return app.authApi.login(body.email, body.token, reply);
    },
  );
  app.post(
    '/v1/auth/logout',
    { preHandler: requireSameOrigin },
    (request, reply) => app.authApi.logout(request, reply),
  );
  app.get('/v1/auth/session', async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ code: 'UNAUTHENTICATED' });
    return { user: request.auth };
  });
  await registerMerchantRoutes(app, env);
  await registerImportRoutes(app, env);
  await registerProductRoutes(app);
  await registerRedirectRoutes(app, resolvedServices);
  await registerAnalyticsRoutes(app, env);
  await registerConversionRoutes(app, env);
  app.get('/health/live', async () => ({ status: 'ok' }));
  app.get('/health/ready', async (_request, reply) => {
    try {
      await resolvedServices.repository.health();
      return { status: 'ok', release: env.RELEASE_VERSION };
    } catch {
      return reply.code(503).send({ status: 'unavailable' });
    }
  });
  app.post('/v1/search', async (request, reply) => {
    const parsed = searchRequestSchema.safeParse(request.body);
    if (!parsed.success)
      return reply
        .code(400)
        .send({ code: 'INVALID_INPUT', requestId: request.id });
    const result = await resolvedServices.search.execute(request.body);
    return {
      ...result,
      items: result.items.map((item) => ({
        ...item,
        checkoutUrl: resolvedServices.redirects.createLink({
          offerId: item.offerId,
          searchId: result.searchId,
          channel: 'web',
        }),
      })),
    };
  });
  app.post('/v1/stores/:merchantId/search', async (request, reply) => {
    const parsed = searchRequestSchema.safeParse(request.body);
    if (!parsed.success)
      return reply
        .code(400)
        .send({ code: 'INVALID_INPUT', requestId: request.id });
    const { merchantId } = request.params as { merchantId: string };
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
        merchantId,
      )
    )
      return reply
        .code(400)
        .send({ code: 'INVALID_INPUT', requestId: request.id });
    const result = await resolvedServices.search.execute(request.body, {
      merchantIds: [merchantId],
    });
    return {
      ...result,
      items: result.items.map((item) => ({
        ...item,
        checkoutUrl: resolvedServices.redirects.createLink({
          offerId: item.offerId,
          searchId: result.searchId,
          channel: 'web',
        }),
      })),
    };
  });
  app.post('/mcp', async (request, reply) => {
    const origin = request.headers.origin;
    if (origin && !env.MCP_ALLOWED_ORIGINS.includes(origin)) {
      return reply.code(403).send({ code: 'FORBIDDEN' });
    }
    const server = createMcpServer(resolvedServices, {
      origin: env.WIDGET_ORIGIN,
      resourceDomains: env.WIDGET_RESOURCE_DOMAINS,
    });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    reply.hijack();
    reply.raw.on('close', () => {
      void transport.close();
      void server.close();
    });
    await transport.handleRequest(request.raw, reply.raw, request.body);
  });
  app.route({
    method: ['GET', 'DELETE'],
    url: '/mcp',
    handler: async (_request, reply) =>
      reply.code(405).send({ code: 'METHOD_NOT_ALLOWED' }),
  });
  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error, requestId: request.id }, 'Request failed');
    const code =
      error && typeof error === 'object' && 'statusCode' in error
        ? error.statusCode
        : undefined;
    const status =
      typeof code === 'number' && code >= 400 && code < 500 ? code : 500;
    return reply.code(status).send({
      code: status < 500 ? 'INVALID_INPUT' : 'INTERNAL_ERROR',
      requestId: request.id,
    });
  });
  app.addHook('onClose', async () => {
    await resolvedServices.close();
    await authDatabase?.close();
  });
  return app;
}
