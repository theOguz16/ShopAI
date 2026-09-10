import { describe, expect, it, vi } from 'vitest';
import {
  buildPinnedHttpsRequestOptions,
  createPublicConnectorFetch,
  resolvePublicConnectorTarget,
} from '../packages/connectors/src/index.js';

describe('connector target safety', () => {
  it.each([
    '127.0.0.1',
    '10.0.0.1',
    '169.254.169.254',
    '192.168.1.10',
    '::1',
    '::ffff:169.254.169.254',
  ])('rejects private or local destination %s', async (address) => {
    const family = address.includes(':') ? 6 : 4;
    await expect(
      resolvePublicConnectorTarget('https://shop.example', async () => [
        { address, family },
      ]),
    ).rejects.toThrow('public bir adres');
  });

  it('pins the actual request to the same public DNS result it validated', async () => {
    const lookup = vi
      .fn()
      .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
      // A vulnerable implementation would resolve the hostname again here and
      // could receive a private address after the public preflight result.
      .mockResolvedValueOnce([{ address: '169.254.169.254', family: 4 }]);
    const requester = vi.fn(async () => new Response('[]', { status: 200 }));
    const safeFetch = createPublicConnectorFetch(lookup, requester);

    await safeFetch(new URL('https://merchant.example/wp-json/wc/v3/products'), {
      redirect: 'manual',
    });

    expect(lookup).toHaveBeenCalledTimes(1);
    expect(requester).toHaveBeenCalledTimes(1);
    const [url, target, init] = requester.mock.calls[0] ?? [];
    expect(target).toEqual({ address: '93.184.216.34', family: 4 });
    expect(
      buildPinnedHttpsRequestOptions(url as URL, target, init as RequestInit),
    ).toMatchObject({
      hostname: '93.184.216.34',
      servername: 'merchant.example',
      headers: { host: 'merchant.example' },
    });
  });

  it('fails closed when any DNS answer includes a private destination', async () => {
    await expect(
      resolvePublicConnectorTarget('https://merchant.example', async () => [
        { address: '93.184.216.34', family: 4 },
        { address: '10.0.0.8', family: 4 },
      ]),
    ).rejects.toThrow('public bir adres');
  });
});
