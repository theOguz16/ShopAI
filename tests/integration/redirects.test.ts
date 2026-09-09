import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../../apps/api/src/app.js';
import { parseApiEnv } from '../../apps/api/src/env.js';
import {
  createServices,
  MemoryRedirectRepository,
} from '../../apps/api/src/services.js';
import {
  RedirectService,
  RedirectTokenError,
  RedirectTokens,
} from '../../packages/commerce/src/redirects.js';
import { demoRecords } from '../../packages/commerce/src/index.js';

const secret = 'test-redirect-signing-secret-000000000000000';

describe('signed redirects', () => {
  it('rejects tampered and expired tokens without accepting a destination', () => {
    const tokens = new RedirectTokens(secret, 60);
    const input = {
      offerId: demoRecords[0]?.offerId ?? randomUUID(),
      searchId: randomUUID(),
      transport: 'rest' as const,
      surface: 'web' as const,
    };
    const token = tokens.create(input, 1_000_000);
    expect(() => tokens.verify(`${token.slice(0, -1)}x`, 1_001_000)).toThrow(
      RedirectTokenError,
    );
    expect(() => tokens.verify(token, 1_061_000)).toThrowError(
      expect.objectContaining({ code: 'EXPIRED_TOKEN' }),
    );
    const payload = JSON.parse(
      Buffer.from(token.split('.')[0] ?? '', 'base64url').toString('utf8'),
    );
    expect(payload).toEqual(
      expect.objectContaining({
        offerId: input.offerId,
        searchId: input.searchId,
        transport: 'rest',
        surface: 'web',
      }),
    );
    expect(payload).not.toHaveProperty('url');
    expect(payload).not.toHaveProperty('merchantId');
    expect(payload).not.toHaveProperty('email');
  });

  it('returns safe HTTP errors for tampered and expired links', async () => {
    const env = parseApiEnv({});
    const services = createServices(env);
    const app = await buildApp(services, env);
    try {
      const tokens = new RedirectTokens(env.REDIRECT_SIGNING_SECRET, 60);
      const expired = tokens.create(
        {
          offerId: demoRecords[0]?.offerId ?? randomUUID(),
          searchId: randomUUID(),
          transport: 'rest',
          surface: 'web',
        },
        1_000_000,
      );
      const expiredResponse = await app.inject({
        method: 'GET',
        url: `/r/${expired}`,
      });
      expect(expiredResponse.statusCode).toBe(410);
      expect(expiredResponse.json()).toMatchObject({
        code: 'EXPIRED_TOKEN',
        message: expect.stringContaining('süresi dolmuş'),
      });
      const tamperedResponse = await app.inject({
        method: 'GET',
        url: `/r/${expired.slice(0, -1)}x`,
      });
      expect(tamperedResponse.statusCode).toBe(400);
      expect(tamperedResponse.json().code).toBe('INVALID_TOKEN');
    } finally {
      await app.close();
    }
  });

  it('does not count link creation and records opens as clicks, not sales', async () => {
    const env = parseApiEnv({});
    const services = createServices(env);
    const repository = services.redirectRepository as MemoryRedirectRepository;
    const app = await buildApp(services, env);
    try {
      const search = await app.inject({
        method: 'POST',
        url: '/v1/search',
        payload: { query: 'Minimal M beden' },
      });
      expect(search.statusCode).toBe(200);
      expect(repository.clicks).toHaveLength(0);
      const link = new URL(search.json().items[0].checkoutUrl);
      expect(link.pathname).toMatch(/^\/r\//u);
      expect(link.searchParams.size).toBe(0);

      const opened = await app.inject({
        method: 'GET',
        url: link.pathname,
        headers: { 'user-agent': 'Mozilla/5.0 ShopAI acceptance test' },
      });
      expect(opened.statusCode).toBe(302);
      expect(opened.headers.location).toBe('https://example.com/products/1');
      expect(repository.clicks).toHaveLength(1);
      expect(repository.clicks[0]).toMatchObject({
        classification: 'human',
        claims: { transport: 'rest', surface: 'web' },
      });
      expect(repository.clicks[0]).not.toHaveProperty('sale');
    } finally {
      await app.close();
    }
  });

  it('separates bot previews and blocks inactive offers', async () => {
    const offerId = randomUUID();
    const repository = new MemoryRedirectRepository(
      new Map([
        [
          offerId,
          {
            url: 'https://merchant.example/product',
            merchantId: randomUUID(),
            active: true,
          },
        ],
      ]),
    );
    const service = new RedirectService(
      new RedirectTokens(secret),
      repository,
      'https://shopai.example',
    );
    const link = service.createLink({
      offerId,
      searchId: randomUUID(),
      transport: 'mcp',
      surface: 'chatgpt',
    });
    const opened = await service.open(
      new URL(link).pathname.slice('/r/'.length),
      'Slackbot-LinkExpanding 1.0',
    );
    expect(opened?.classification).toBe('bot');
    expect(repository.clicks[0]).toMatchObject({
      classification: 'bot',
      claims: { transport: 'mcp', surface: 'chatgpt' },
    });

    const inactiveRepository = new MemoryRedirectRepository(
      new Map([
        [
          offerId,
          {
            url: 'https://evil.example/client-selected',
            merchantId: randomUUID(),
            active: false,
          },
        ],
      ]),
    );
    const inactive = new RedirectService(
      new RedirectTokens(secret),
      inactiveRepository,
      'https://shopai.example',
    );
    expect(
      await inactive.open(new URL(link).pathname.slice('/r/'.length)),
    ).toBeNull();
    expect(inactiveRepository.clicks).toHaveLength(0);
  });
});
