import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../apps/api/src/app.js';
import { parseApiEnv } from '../../apps/api/src/env.js';
import { createServices } from '../../apps/api/src/services.js';

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
describe('API and MCP', () => {
  it('fails readiness when the database-backed repository is unavailable', async () => {
    const env = parseApiEnv({});
    const services = createServices(env);
    services.repository.health = async () => {
      throw new Error('database unavailable');
    };
    const app = await buildApp(services, env);
    apps.push(app);
    const response = await app.inject('/health/ready');
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: 'unavailable' });
  });
  it('exposes a filtered public search and validates input', async () => {
    const app = await buildApp();
    apps.push(app);
    expect((await app.inject('/health/ready')).statusCode).toBe(200);
    const result = await app.inject({
      method: 'POST',
      url: '/v1/search',
      payload: { filters: { colors: ['black'], sizes: ['M'] } },
    });
    expect(result.statusCode).toBe(200);
    expect(result.json().items).toHaveLength(1);
    expect(result.json().searchId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(result.json().facets.categories).toEqual([
      { value: 'tshirt', count: 1 },
    ]);
    const scoped = await app.inject({
      method: 'POST',
      url: '/v1/stores/10000000-0000-4000-8000-000000000001/search',
      payload: {
        merchantIds: ['90000000-0000-4000-8000-000000000001'],
      },
    });
    expect(scoped.statusCode).toBe(200);
    expect(scoped.json().items).toEqual([]);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/search',
          payload: { limit: 51 },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/merchants/test/imports',
          payload: {},
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/merchants/test/products/test/publication',
          payload: { published: true },
        })
      ).statusCode,
    ).toBe(401);
  });
  it('calls the shared search via stateless MCP', async () => {
    const app = await buildApp();
    apps.push(app);
    const response = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { accept: 'application/json, text/event-stream' },
      payload: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'search_products',
          arguments: { query: 'Siyah M beden tişört' },
        },
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().result.structuredContent.items).toHaveLength(1);
  });
  it('rejects untrusted browser origins for MCP', async () => {
    const app = await buildApp();
    apps.push(app);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/mcp',
          headers: { origin: 'https://evil.example' },
          payload: {},
        })
      ).statusCode,
    ).toBe(403);
  });
  it('protects management routes and cookie login with backend auth', async () => {
    const app = await buildApp();
    apps.push(app);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/v1/merchants/10000000-0000-4000-8000-000000000001',
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/auth/login',
          headers: { origin: 'https://evil.example' },
          payload: {
            email: 'pilot@shopai.local',
            token: 'shopai-local-pilot-token',
          },
        })
      ).statusCode,
    ).toBe(403);
  });
  it('accepts the configured staging web origin for auth mutations', async () => {
    const env = parseApiEnv({
      MCP_ALLOWED_ORIGINS: 'https://web.staging.example',
    });
    const app = await buildApp(undefined, env);
    apps.push(app);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      headers: { origin: 'https://web.staging.example' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  it('starts staging without a conversion secret and keeps callbacks disabled', async () => {
    const env = parseApiEnv({
      DEPLOY_ENV: 'staging',
      RELEASE_VERSION: 'abcdef123',
      CATALOG_MODE: 'postgres',
      DATABASE_URL: 'postgresql://shopai:test@db.example/shopai',
      MCP_PUBLIC_ORIGIN: 'https://api.staging.example',
      WIDGET_ORIGIN: 'https://widget.staging.example',
      MCP_ALLOWED_ORIGINS: 'https://web.staging.example',
      REDIRECT_SIGNING_SECRET: 'staging-redirect-secret-000000000000',
      AUTH_PILOT_CREDENTIALS:
        '{"owner@staging.example":"staging-user-secret-000000000000"}',
      CONVERSION_CALLBACK_SECRET: '',
    });
    const localServices = createServices(parseApiEnv({}));
    const app = await buildApp(localServices, env);
    apps.push(app);

    expect(env.CONVERSION_CALLBACK_SECRET).toBeUndefined();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/conversions/10000000-0000-4000-8000-000000000001/10000000-0000-4000-8000-000000000002',
      payload: {},
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ code: 'CONVERSION_NOT_CONFIGURED' });
  });
});
