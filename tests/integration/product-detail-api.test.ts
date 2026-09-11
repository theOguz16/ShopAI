import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../apps/api/src/app.js';
import { parseApiEnv } from '../../apps/api/src/env.js';
import { createServices } from '../../apps/api/src/services.js';

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('public product detail transport', () => {
  it('returns the same variant availability over REST and MCP', async () => {
    const env = parseApiEnv({});
    const services = createServices(env);
    const app = await buildApp(services, env);
    apps.push(app);
    const productId = '20000000-0000-4000-8000-000000000001';

    const rest = await app.inject({
      method: 'GET',
      url: `/v1/products/${productId}/detail`,
    });
    expect(rest.statusCode).toBe(200);
    const restDetail = rest.json();
    expect(restDetail.product.id).toBe(productId);
    expect(restDetail.variants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          size: 'M',
          availability: 'in_stock',
          selectable: true,
        }),
        expect.objectContaining({
          size: 'L',
          availability: 'out_of_stock',
          selectable: false,
        }),
      ]),
    );
    const unavailableRestOffer = restDetail.offers.find(
      (offer: { availability: string }) => offer.availability === 'out_of_stock',
    );
    expect(unavailableRestOffer).toMatchObject({
      checkoutAvailable: false,
      checkoutUrl: null,
    });

    const mcp = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { accept: 'application/json, text/event-stream' },
      payload: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'get_product_detail',
          arguments: { productId },
        },
      },
    });
    expect(mcp.statusCode).toBe(200);
    const mcpDetail = mcp.json().result.structuredContent;
    expect(
      mcpDetail.variants.map(
        (variant: {
          size: string;
          availability: string;
          selectable: boolean;
        }) => ({
          size: variant.size,
          availability: variant.availability,
          selectable: variant.selectable,
        }),
      ),
    ).toEqual(
      restDetail.variants.map(
        (variant: {
          size: string;
          availability: string;
          selectable: boolean;
        }) => ({
          size: variant.size,
          availability: variant.availability,
          selectable: variant.selectable,
        }),
      ),
    );
  });
});
