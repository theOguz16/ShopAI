import { describe, expect, it, vi } from 'vitest';
import {
  createPublicConnectorFetch,
  resolvePublicConnectorTarget,
} from '../packages/connectors/src/index.js';

describe('connector target allow policy (explicit test-only escape)', () => {
  it('rejects localhost targets when no policy is passed (production default)', async () => {
    await expect(
      resolvePublicConnectorTarget('https://localhost:18443/wp-json/'),
    ).rejects.toThrow('public bir adres');
    await expect(
      resolvePublicConnectorTarget('https://woo.internal/'),
    ).rejects.toThrow('public bir adres');
  });

  it('permits an explicitly allowed local hostname while keeping IP pinning', async () => {
    const lookup = vi
      .fn()
      .mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
    const target = await resolvePublicConnectorTarget(
      'https://localhost:18443/wp-json/wc/v3/products',
      lookup,
      { allowHosts: ['localhost'] },
    );
    expect(target).toEqual({ address: '127.0.0.1', family: 4 });
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('keeps private targets rejected when the hostname is not on the allow list', async () => {
    const lookup = vi
      .fn()
      .mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
    await expect(
      resolvePublicConnectorTarget('https://localhost:18443/', lookup, {
        allowHosts: ['other-host.example'],
      }),
    ).rejects.toThrow('public bir adres');
  });

  it('still rejects non-HTTPS targets even with an allow policy', async () => {
    await expect(
      resolvePublicConnectorTarget('http://localhost:18443/', undefined, {
        allowHosts: ['localhost'],
      }),
    ).rejects.toThrow('HTTPS');
  });

  it('pinned fetch passes the allow policy through', async () => {
    const requester = vi.fn(async () => new Response('[]', { status: 200 }));
    const safeFetch = createPublicConnectorFetch(
      async () => [{ address: '127.0.0.1', family: 4 }],
      requester,
      { allowHosts: ['localhost'] },
    );
    await safeFetch(new URL('https://localhost:18443/wp-json/'), {
      redirect: 'manual',
    });
    expect(requester).toHaveBeenCalledTimes(1);
  });

  it('refuses auto redirects before dialing (every hop would need revalidation)', async () => {
    // Default requester: the pinned HTTPS requester throws on any non-manual
    // redirect policy before a socket is opened.
    const safeFetch = createPublicConnectorFetch(
      async () => [{ address: '127.0.0.1', family: 4 }],
      undefined,
      { allowHosts: ['localhost'] },
    );
    await expect(
      safeFetch(new URL('https://localhost:18443/wp-json/'), {
        redirect: 'follow',
      }),
    ).rejects.toThrow('yönlendirme');
  });
});
