import { describe, expect, it, vi } from 'vitest';
import {
  ConnectorHttpError,
  WooCommerceConnector,
} from '../packages/connectors/src/index.js';

const credentials = {
  storeUrl: 'https://pilot.example',
  consumerKey: 'ck_test_sensitive',
  consumerSecret: 'cs_test_sensitive',
};

describe('WooCommerce upstream diagnostics', () => {
  it('captures only safe diagnostics and redacts credentials', async () => {
    const basicCredential = Buffer.from(
      `${credentials.consumerKey}:${credentials.consumerSecret}`,
    ).toString('base64');
    const fetcher = vi.fn(
      async () =>
        new Response(
          [
            '<html>upstream failure',
            credentials.consumerKey,
            credentials.consumerSecret,
            `Authorization: Basic ${basicCredential}`,
            'x'.repeat(1500),
            '</html>',
          ].join(' '),
          {
            status: 530,
            headers: {
              'content-type': 'text/html; charset=UTF-8',
              server: 'cloudflare',
              'retry-after': '60',
              'cf-ray': 'abc123-IST',
              'x-request-id': 'request-123',
              'set-cookie': 'session=must-not-be-logged',
            },
          },
        ),
    );
    const connector = new WooCommerceConnector(
      credentials,
      fetcher as typeof fetch,
      vi.fn(async () => undefined),
      1,
    );

    let thrown: unknown;
    try {
      await connector.validate();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ConnectorHttpError);
    const error = thrown as ConnectorHttpError;
    expect(error).toMatchObject({
      status: 530,
      retryAfterMs: 30_000,
      diagnostics: {
        contentType: 'text/html; charset=UTF-8',
        upstreamServer: 'cloudflare',
        retryAfter: '60',
        cfRay: 'abc123-IST',
        requestId: 'request-123',
      },
    });
    expect(error.message).toBe('WooCommerce HTTP 530');
    expect(error.diagnostics?.responseBodySnippet?.length).toBeLessThanOrEqual(
      1024,
    );

    const serialized = JSON.stringify(error.diagnostics);
    expect(serialized).not.toContain(credentials.consumerKey);
    expect(serialized).not.toContain(credentials.consumerSecret);
    expect(serialized).not.toContain(basicCredential);
    expect(serialized).not.toContain('must-not-be-logged');
    expect(serialized).toContain('[REDACTED]');
  });
});
