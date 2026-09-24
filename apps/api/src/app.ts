import { randomUUID } from 'node:crypto';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import {
  discoverySessionCreateRequestSchema,
  searchRequestSchema,
} from '@shopai/contracts';
import { searchProductsRequestSchema } from '@shopai/contracts/search-products';
import {
  createConnectorSecretBackend,
  type ConnectorSecretBackend,
} from '@shopai/connectors';
import { createDatabase } from '@shopai/db';
import { sql } from 'drizzle-orm';
import Fastify from 'fastify';
import { z } from 'zod';
import { registerBetterAuthRoutes } from './better-auth-routes.js';
import { type ApiEnv, parseApiEnv } from './env.js';
import { createMcpServer } from './mcp.js';
import { createOpsAlertSender } from './ops-alert.js';
import {
  registerAuth,
  requireRecentMfa,
  requireSameOrigin,
} from './plugins/auth.js';
import { registerAnalyticsRoutes } from './routes/analytics.js';
import { registerConversionRoutes } from './routes/conversions.js';
import { registerImportRoutes } from './routes/imports.js';
import { registerInteractionEventRoutes } from './routes/interaction-events.js';
import { registerMerchantRoutes } from './routes/merchants.js';
import {
  type OnboardingConnectorFactory,
  registerOnboardingRoutes,
} from './routes/onboarding.js';
import { registerProductAlertRoutes } from './routes/product-alerts.js';
import { registerProductDetailRoutes } from './routes/product-detail.js';
import { registerProductRoutes } from './routes/products.js';
import { registerRedirectRoutes } from './routes/redirects.js';
import {
  registerSavedProductRoutes,
  resolveShopperIdentity,
} from './routes/saved-products.js';
import { registerStorefrontRoutes } from './routes/storefronts.js';
import { registerSyncStatusRoutes } from './routes/sync-status.js';
import { createServices, type Services } from './services.js';

const loginRequestSchema = z
  .object({
    email: z.string().trim().email().max(254),
    token: z.string().min(16).max(256),
  })
  .strict();
const restDiscoverySurfaces = new Set(['web', 'brand_widget']);

function isSearchRoute(route: string) {
  return (
    route === '/v1/search' ||
    route === '/v1/stores/:merchantId/search' ||
    route === '/mcp'
  );
}

export type BuildAppOptions = {
  onboardingConnectorFactory?: OnboardingConnectorFactory;
  connectorSecretBackend?: ConnectorSecretBackend;
};

export async function buildApp(
  services?: Services,
  env: ApiEnv = parseApiEnv(process.env),
  options: BuildAppOptions = {},
) {
  const resolvedServices = services ?? createServices(env);
  const authDatabase =
    env.CATALOG_MODE === 'postgres'
      ? createDatabase(env.DATABASE_URL)
      : undefined;
  const opsAlerts = createOpsAlertSender(env);
  const connectorSecretBackend =
    options.connectorSecretBackend ??
    createConnectorSecretBackend({
      backend: env.CONNECTOR_SECRET_BACKEND,
      privateRoot: env.UPLOAD_DIR,
      encryptionKey: env.CONNECTOR_SECRET_ENCRYPTION_KEY,
      address: env.CONNECTOR_SECRET_OPENBAO_ADDRESS,
      mount: env.CONNECTOR_SECRET_OPENBAO_MOUNT,
      roleId: env.CONNECTOR_SECRET_OPENBAO_ROLE_ID,
      secretId: env.CONNECTOR_SECRET_OPENBAO_SECRET_ID,
      secretIdFile: env.CONNECTOR_SECRET_OPENBAO_SECRET_ID_FILE,
    });
  if (env.CONNECTOR_SECRET_BACKEND === 'openbao')
    await connectorSecretBackend.health();
  const app = Fastify({
    routerOptions: { maxParamLength: 1024 },
    // Verification and reset URLs contain secrets: never log raw request URLs.
    disableRequestLogging: true,
    logger: {
      level: env.LOG_LEVEL,
      redact: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers.x-shopai-signature',
        'req.body.consumerKey',
        'req.body.consumerSecret',
        'req.body.apiKey',
        'req.body.apiSecret',
        'req.body.token',
        'req.body.pilotToken',
        'req.body.code',
        'req.body.password',
        'req.body.newPassword',
        'req.query.code',
        'req.query.state',
        'req.query.token',
        'req.body.totp',
        'req.body.backupCode',
        'req.body.AUTH_PILOT_CREDENTIALS',
        'req.body.email',
      ],
    },
    bodyLimit: 2 * 1024 * 1024 + 16384,
  });
  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });
  app.addHook('onResponse', async (request, reply) => {
    const route = request.routeOptions.url ?? request.url;
    if (reply.statusCode >= 500 && isSearchRoute(route)) {
      const fields = {
        requestId: request.id,
        method: request.method,
        route,
        statusCode: reply.statusCode,
      };
      request.log.error(
        {
          event: 'search_error',
          release: env.RELEASE_VERSION,
          ...fields,
        },
        'Search request failed',
      );
      void opsAlerts.send('search_error', 'error', fields);
    }
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
  registerBetterAuthRoutes(app, authDatabase?.db, env);
  app.get('/v1/auth/capabilities', async () => ({
    betterAuthEnabled: env.BETTER_AUTH_ENABLED === 'true',
    pilotEnabled: app.authApi.pilotEnabled,
  }));
  app.post(
    '/v1/auth/login',
    {
      config: {
        rateLimit: { max: env.LOGIN_RATE_LIMIT_MAX, timeWindow: '1 minute' },
      },
      preHandler: requireSameOrigin,
    },
    async (request, reply) => {
      const parsed = loginRequestSchema.safeParse(request.body);
      if (!parsed.success)
        return reply.code(400).send({ code: 'INVALID_INPUT' });
      return app.authApi.login(parsed.data.email, parsed.data.token, reply);
    },
  );
  app.post(
    '/v1/auth/logout',
    { preHandler: requireSameOrigin },
    (request, reply) => app.authApi.logout(request, reply),
  );
  app.post(
    '/v1/auth/logout-all',
    { preHandler: requireSameOrigin },
    (request, reply) => app.authApi.logoutAll(request, reply),
  );
  app.post(
    '/v1/auth/account/close',
    { preHandler: [requireSameOrigin, requireRecentMfa] },
    async (request, reply) => {
      if (!request.auth || !authDatabase?.db)
        return reply.code(401).send({ code: 'UNAUTHENTICATED' });
      const userId = request.auth.userId;
      const outcome = await authDatabase.db.transaction(async (tx) => {
        const account = await tx.execute(
          sql`SELECT account_status FROM users WHERE id=${userId}::uuid FOR UPDATE`,
        );
        if (account.rows[0]?.account_status !== 'active')
          return 'ACCOUNT_INACTIVE';
        const owner = await tx.execute(
          sql`SELECT 1 FROM memberships WHERE user_id=${userId}::uuid AND role='owner' LIMIT 1`,
        );
        if (owner.rows.length) return 'OWNER_TRANSFER_REQUIRED';
        await tx.execute(sql`
          UPDATE shopai_auth."session" SET "expiresAt"=now()
          WHERE "userId" IN (
            SELECT subject FROM user_identities
            WHERE user_id=${userId}::uuid AND issuer='better-auth'
          )
        `);
        await tx.execute(
          sql`UPDATE users SET account_status='closed',closed_at=now() WHERE id=${userId}::uuid`,
        );
        await tx.execute(
          sql`UPDATE sessions SET revoked_at=now() WHERE user_id=${userId}::uuid AND revoked_at IS NULL`,
        );
        await tx.execute(
          sql`INSERT INTO auth_audit_events (user_id,event_type,outcome,request_id) VALUES (${userId}::uuid,'account_closing','success',${request.id})`,
        );
        return 'OK';
      });
      if (outcome !== 'OK') return reply.code(409).send({ code: outcome });
      return app.authApi.logout(request, reply);
    },
  );
  app.get('/v1/auth/session', async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ code: 'UNAUTHENTICATED' });
    return { user: request.auth, csrfToken: app.authApi.csrfToken(request) };
  });
  await registerMerchantRoutes(app, env, connectorSecretBackend);
  await registerOnboardingRoutes(
    app,
    env,
    connectorSecretBackend,
    options.onboardingConnectorFactory,
  );
  await registerSyncStatusRoutes(app);
  await registerStorefrontRoutes(app);
  await registerSavedProductRoutes(app, resolvedServices, env);
  await registerProductAlertRoutes(app, resolvedServices, env);
  await registerImportRoutes(app, env);
  await registerInteractionEventRoutes(app, resolvedServices);
  await registerProductRoutes(app);
  await registerProductDetailRoutes(app, resolvedServices);
  await registerRedirectRoutes(app, resolvedServices);
  await registerAnalyticsRoutes(app, env);
  await registerConversionRoutes(app, env);
  app.get('/health/live', async () => ({ status: 'ok' }));
  app.get('/health/ready', async (_request, reply) => {
    try {
      await resolvedServices.repository.health();
      if (env.CONNECTOR_SECRET_BACKEND === 'openbao')
        await connectorSecretBackend.health();
      return { status: 'ok', release: env.RELEASE_VERSION };
    } catch {
      return reply.code(503).send({ status: 'unavailable' });
    }
  });
  app.post(
    '/discovery-session',
    { preHandler: requireSameOrigin },
    async (request, reply) => {
      const parsed = discoverySessionCreateRequestSchema.safeParse(
        request.body,
      );
      if (!parsed.success)
        return reply
          .code(400)
          .send({ code: 'INVALID_INPUT', requestId: request.id });
      if (!restDiscoverySurfaces.has(parsed.data.surface))
        return reply.code(400).send({
          code: 'INVALID_SURFACE_FOR_TRANSPORT',
          requestId: request.id,
        });
      try {
        const session = await resolvedServices.discoverySessions.create(
          parsed.data,
          {
            transport: 'rest',
            userId: request.auth?.userId,
          },
        );
        return reply.code(201).send(session);
      } catch (error) {
        if (
          error &&
          typeof error === 'object' &&
          'statusCode' in error &&
          error.statusCode === 404 &&
          'code' in error &&
          error.code === 'MERCHANT_NOT_FOUND'
        )
          return reply.code(404).send({
            code: 'MERCHANT_NOT_FOUND',
            requestId: request.id,
          });
        throw error;
      }
    },
  );
  const mcpSessions = new Map<
    string,
    {
      transport: StreamableHTTPServerTransport;
      server: ReturnType<typeof createMcpServer>;
    }
  >();

  function mcpSessionId(header: string | string[] | undefined) {
    return Array.isArray(header) ? header[0] : header;
  }

  function allowMcpOrigin(origin: string | undefined) {
    return !origin || env.MCP_ALLOWED_ORIGINS.includes(origin);
  }
  app.post('/v1/search', async (request, reply) => {
    const publicRequest = searchProductsRequestSchema.safeParse(request.body);
    const legacyRequest = searchRequestSchema.safeParse(request.body);
    if (!publicRequest.success && !legacyRequest.success)
      return reply
        .code(400)
        .send({ code: 'INVALID_INPUT', requestId: request.id });
    const attribution = await resolvedServices.resolveRestAttribution(
      request.body,
    );
    if (publicRequest.success) {
      const result = await resolvedServices.executePublicSearch(
        publicRequest.data,
        {},
        attribution,
      );
      return {
        ...result,
        products: result.products.map((item) => ({
          ...item,
          checkoutUrl: resolvedServices.redirects.createLink({
            offerId: item.offerId,
            searchId: result.searchId,
            ...attribution,
          }),
        })),
      };
    }
    const result = await resolvedServices.executeSearch(
      request.body,
      {},
      attribution,
    );
    return {
      ...result,
      items: result.items.map((item) => ({
        ...item,
        checkoutUrl: resolvedServices.redirects.createLink({
          offerId: item.offerId,
          searchId: result.searchId,
          ...attribution,
        }),
      })),
    };
  });
  app.post('/v1/stores/:merchantId/search', async (request, reply) => {
    const publicRequest = searchProductsRequestSchema.safeParse(request.body);
    const legacyRequest = searchRequestSchema.safeParse(request.body);
    if (!publicRequest.success && !legacyRequest.success)
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
    const attribution = await resolvedServices.resolveRestAttribution(
      request.body,
    );
    if (publicRequest.success) {
      const result = await resolvedServices.executePublicSearch(
        publicRequest.data,
        { merchantIds: [merchantId] },
        attribution,
      );
      return {
        ...result,
        products: result.products.map((item) => ({
          ...item,
          checkoutUrl: resolvedServices.redirects.createLink({
            offerId: item.offerId,
            searchId: result.searchId,
            ...attribution,
          }),
        })),
      };
    }
    const result = await resolvedServices.executeSearch(
      request.body,
      { merchantIds: [merchantId] },
      attribution,
    );
    return {
      ...result,
      items: result.items.map((item) => ({
        ...item,
        checkoutUrl: resolvedServices.redirects.createLink({
          offerId: item.offerId,
          searchId: result.searchId,
          ...attribution,
        }),
      })),
    };
  });
  app.post('/mcp', async (request, reply) => {
    const origin = request.headers.origin;
    if (!allowMcpOrigin(origin))
      return reply.code(403).send({ code: 'FORBIDDEN' });
    const sessionId = mcpSessionId(request.headers['mcp-session-id']);
    if (sessionId) {
      const session = mcpSessions.get(sessionId);
      if (!session)
        return reply.code(404).send({ code: 'MCP_SESSION_NOT_FOUND' });
      if (origin) {
        reply.raw.setHeader('Access-Control-Allow-Origin', origin);
        reply.raw.setHeader('Access-Control-Allow-Credentials', 'true');
        reply.raw.setHeader('Vary', 'Origin');
      }
      reply.hijack();
      await session.transport.handleRequest(
        request.raw,
        reply.raw,
        request.body,
      );
      return;
    }
    const shopperIdentity = await resolveShopperIdentity(
      request,
      reply,
      resolvedServices,
      env,
    );
    const server = createMcpServer(
      resolvedServices,
      {
        origin: env.WIDGET_ORIGIN,
        resourceDomains: env.WIDGET_RESOURCE_DOMAINS,
        redirectOrigin: env.MCP_PUBLIC_ORIGIN,
      },
      {
        savedProducts: app.savedProductsApi,
        productAlerts: app.productAlertsApi,
        identity: shopperIdentity,
      },
    );
    if (isInitializeRequest(request.body)) {
      let transport: StreamableHTTPServerTransport;
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: randomUUID,
        enableJsonResponse: true,
        onsessioninitialized: (initializedSessionId) => {
          mcpSessions.set(initializedSessionId, { transport, server });
        },
      });
      transport.onclose = () => {
        const initializedSessionId = transport.sessionId;
        if (initializedSessionId) mcpSessions.delete(initializedSessionId);
      };
      await server.connect(transport);
      if (origin) {
        reply.raw.setHeader('Access-Control-Allow-Origin', origin);
        reply.raw.setHeader('Access-Control-Allow-Credentials', 'true');
        reply.raw.setHeader('Vary', 'Origin');
      }
      reply.hijack();
      await transport.handleRequest(request.raw, reply.raw, request.body);
      return;
    }
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    if (origin) {
      reply.raw.setHeader('Access-Control-Allow-Origin', origin);
      reply.raw.setHeader('Access-Control-Allow-Credentials', 'true');
      reply.raw.setHeader('Vary', 'Origin');
    }
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
    handler: async (request, reply) => {
      const origin = request.headers.origin;
      if (!allowMcpOrigin(origin))
        return reply.code(403).send({ code: 'FORBIDDEN' });
      const sessionId = mcpSessionId(request.headers['mcp-session-id']);
      const session = sessionId ? mcpSessions.get(sessionId) : undefined;
      if (!session)
        return reply.code(404).send({ code: 'MCP_SESSION_NOT_FOUND' });
      if (origin) {
        reply.raw.setHeader('Access-Control-Allow-Origin', origin);
        reply.raw.setHeader('Access-Control-Allow-Credentials', 'true');
        reply.raw.setHeader('Vary', 'Origin');
      }
      reply.hijack();
      await session.transport.handleRequest(request.raw, reply.raw);
    },
  });
  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error, requestId: request.id }, 'Request failed');
    const code =
      error && typeof error === 'object' && 'statusCode' in error
        ? error.statusCode
        : undefined;
    const status =
      typeof code === 'number' && code >= 400 && code < 500 ? code : 500;
    const route = request.routeOptions.url ?? request.url;
    if (status >= 500 && !isSearchRoute(route))
      void opsAlerts.send('request_failed', 'error', {
        requestId: request.id,
        method: request.method,
        route,
        statusCode: status,
        errorName: error instanceof Error ? error.name : 'unknown',
      });
    return reply.code(status).send({
      code: status < 500 ? 'INVALID_INPUT' : 'INTERNAL_ERROR',
      requestId: request.id,
    });
  });
  app.addHook('onClose', async () => {
    await Promise.all(
      [...mcpSessions.values()].map(async ({ server, transport }) => {
        await transport.close();
        await server.close();
      }),
    );
    mcpSessions.clear();
    await resolvedServices.close();
    await authDatabase?.close();
  });
  return app;
}
