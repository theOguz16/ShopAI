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
    expect(result.structuredContent.items).toHaveLength(1);
    expect(result.content[0].text).toMatch(
      /Minimal Siyah Tişört.*M beden.*http:\/\/127\.0\.0\.1:4000\/r\//s,
    );
  });

  it('uses the same hard size rule for HTTP and widget-triggered MCP searches', async () => {
    const app = await buildApp();
    apps.push(app);
    const http = await app.inject({
      method: 'POST',
      url: '/v1/search',
      payload: { query: 'siyah tişört', filters: { sizes: ['L'] } },
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
          arguments: { query: 'siyah tişört', filters: { sizes: ['L'] } },
        },
      },
    });
    expect(mcp.json().result.structuredContent.items).toEqual(
      http.json().items,
    );
    expect(mcp.json().result.structuredContent.appliedFilters.sizes).toEqual([
      'L',
    ]);
  });
});
