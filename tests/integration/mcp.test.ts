import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../apps/api/src/app.js';
import { SHOPAI_WIDGET_URI } from '../../apps/api/src/mcp.js';

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function rpc(method: string, params?: unknown) {
  const app = await buildApp();
  apps.push(app);
  return app.inject({
    method: 'POST',
    url: '/mcp',
    headers: { accept: 'application/json, text/event-stream' },
    payload: { jsonrpc: '2.0', id: 1, method, params },
  });
}

function commerceIdentity(products: Array<Record<string, unknown>>) {
  return products.map(
    ({ checkoutUrl: _checkoutUrl, ...product }) => product,
  );
}

describe('MCP Apps product widget', () => {
  it('registers a versioned UI resource with CSP and compatibility metadata', async () => {
    const listed = await rpc('tools/list');
    const tool = listed
      .json()
      .result.tools.find(
        (entry: { name: string }) => entry.name === 'search_products',
      );
    expect(tool._meta.ui).toEqual({
      resourceUri: SHOPAI_WIDGET_URI,
      visibility: ['model', 'app'],
    });
    expect(tool._meta['openai/outputTemplate']).toBe(SHOPAI_WIDGET_URI);
    expect(tool._meta['shopai/dtoVersion']).toBe(1);
    expect(tool.inputSchema.properties).toHaveProperty('attributes');
    expect(tool.inputSchema.properties).toHaveProperty('price');
    expect(tool.inputSchema.properties).not.toHaveProperty('filters');

    const resource = await rpc('resources/read', { uri: SHOPAI_WIDGET_URI });
    const content = resource.json().result.contents[0];
    expect(content.mimeType).toBe('text/html;profile=mcp-app');
    expect(content.text).toContain('/assets/widget-v1.js');
    expect(content._meta.ui).toMatchObject({
      domain: 'http://127.0.0.1:3001',
      csp: {
        connectDomains: [],
        resourceDomains: ['http://127.0.0.1:3001', 'https://example.com'],
      },
    });
  });

  it('keeps a useful text result when UI rendering is unavailable', async () => {
    const response = await rpc('tools/call', {
      name: 'search_products',
      arguments: { query: 'Siyah M beden tişört' },
    });
    const result = response.json().result;
    expect(result.structuredContent.products).toHaveLength(1);
    expect(result.content[0].text).toMatch(
      /Minimal Siyah Tişört.*M beden.*http:\/\/127\.0\.0\.1:4000\/r\//s,
    );
  });

  it('produces the same commerce result set for the same REST and MCP request', async () => {
    const app = await buildApp();
    apps.push(app);
    const request = {
      query: 'siyah tişört',
      category: 'tshirt',
      price: { max: 200_000 },
      attributes: { size: ['L'], color: ['black'] },
      inStockOnly: false,
      limit: 12,
    };
    const http = await app.inject({
      method: 'POST',
      url: '/v1/search',
      payload: request,
    });
    const mcp = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { accept: 'application/json, text/event-stream' },
      payload: {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'search_products',
          arguments: request,
        },
      },
    });

    expect(http.statusCode).toBe(200);
    expect(mcp.statusCode).toBe(200);
    const restResult = http.json();
    const mcpResult = mcp.json().result.structuredContent;
    expect(commerceIdentity(mcpResult.products)).toEqual(
      commerceIdentity(restResult.products),
    );
    expect(mcpResult.facets).toEqual(restResult.facets);
    expect(Object.keys(restResult).sort()).toEqual(
      ['facets', 'products', 'searchId'].sort(),
    );
    expect(Object.keys(mcpResult).sort()).toEqual(
      ['facets', 'products', 'searchId'].sort(),
    );
  });
});
