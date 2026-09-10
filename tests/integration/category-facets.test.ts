import { describe, expect, it } from 'vitest';
import { buildApp } from '../../apps/api/src/app.js';
import { parseApiEnv } from '../../apps/api/src/env.js';

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;

if (!databaseUrl || !redisUrl) {
  describe.skip('category facets integration', () => {
    it('requires PostgreSQL and Redis', () => undefined);
  });
} else {
  const env = parseApiEnv({
    CATALOG_MODE: 'postgres',
    DATABASE_URL: databaseUrl,
    REDIS_URL: redisUrl,
    MCP_PUBLIC_ORIGIN: 'https://api.category-facets.test',
    WIDGET_ORIGIN: 'https://widget.category-facets.test',
    REDIRECT_SIGNING_SECRET: 'category-facets-redirect-secret-000000000000',
    LOG_LEVEL: 'silent',
  });

  describe('category facets integration', () => {
    it('returns different pilot facet sets per category', async () => {
      const app = await buildApp(undefined, env);
      try {
        const tshirt = await app.inject({
          method: 'GET',
          url: '/categories/tshirt/facets',
        });
        expect(tshirt.statusCode).toBe(200);
        expect(tshirt.json()).toEqual({
          size: ['S', 'M', 'L', 'XL'],
          color: ['black', 'white', 'navy', 'gray'],
          fit: ['slim', 'regular', 'oversized'],
          sleeve: ['short', 'long'],
        });

        const fishingRod = await app.inject({
          method: 'GET',
          url: '/categories/fishing-rod/facets',
        });
        expect(fishingRod.statusCode).toBe(200);
        expect(fishingRod.json()).toEqual({
          length: ['1.80 m', '2.10 m', '2.40 m', '2.70 m'],
          action: ['slow', 'moderate', 'fast'],
          casting_weight: ['5-20 g', '10-30 g', '20-60 g'],
        });
      } finally {
        await app.close();
      }
    });

    it('returns 404 for categories outside the pilot set', async () => {
      const app = await buildApp(undefined, env);
      try {
        const response = await app.inject({
          method: 'GET',
          url: '/categories/unknown/facets',
        });
        expect(response.statusCode).toBe(404);
      } finally {
        await app.close();
      }
    });
  });
}
