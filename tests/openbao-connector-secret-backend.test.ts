import { describe, expect, it } from 'vitest';
import { OpenBaoConnectorSecretBackend } from '../packages/connectors/src/secret-backend.js';

const scope = {
  merchantId: '11111111-1111-4111-8111-111111111111',
  connectionId: '22222222-2222-4222-8222-222222222222',
  provider: 'woocommerce',
};
const credentials = {
  storeUrl: 'https://merchant.example',
  consumerKey: 'ck_openbao_test_value',
  consumerSecret: 'cs_openbao_test_value',
};

function fixture() {
  const stored = new Map<string, unknown>();
  const calls: string[] = [];
  let available = true;
  const request = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push(`${method} ${new URL(url).pathname}`);
    if (!available) throw new Error(credentials.consumerSecret);
    if (url.endsWith('/auth/approle/login'))
      return Response.json({ auth: { client_token: 'test-scoped-token' } });
    if (
      init?.headers &&
      (init.headers as Record<string, string>)['x-vault-token'] !==
        'test-scoped-token'
    )
      return new Response(null, { status: 403 });
    const path = new URL(url).pathname;
    if (path.endsWith('/data/health'))
      return Response.json({ data: { data: { ready: true } } });
    if (method === 'POST') {
      stored.set(
        path,
        (JSON.parse(String(init?.body)) as { data: unknown }).data,
      );
      return Response.json({ data: { version: 1 } });
    }
    if (method === 'DELETE') {
      stored.delete(path.replace('/metadata/', '/data/'));
      return new Response(null, { status: 204 });
    }
    const value = stored.get(path);
    return value
      ? Response.json({ data: { data: value } })
      : new Response(null, { status: 404 });
  };
  const backend = new OpenBaoConnectorSecretBackend(
    {
      address: 'https://openbao.shopai.internal:8200',
      mount: 'shopai-staging',
      roleId: 'api-role-id',
      secretId: 'api-secret-id',
    },
    request as typeof fetch,
  );
  return {
    backend,
    stored,
    calls,
    unavailable: () => {
      available = false;
    },
  };
}

describe('OpenBao connector backend contract', () => {
  it('creates, resolves, rotates and revokes opaque scoped references', async () => {
    const { backend, stored, calls } = fixture();
    await backend.health();
    const first = await backend.createScoped(credentials, scope);
    expect(first).toMatch(/^secret:\/\/ONBOARDING_[A-F0-9]{32}$/u);
    expect([...stored.keys()][0]).toContain(
      `/shopai-staging/data/connectors/${scope.merchantId}/${scope.connectionId}/${scope.provider}/`,
    );
    await expect(backend.resolveScoped(first, scope)).resolves.toEqual(
      credentials,
    );
    await expect(
      backend.resolveScoped(first, {
        ...scope,
        merchantId: '33333333-3333-4333-8333-333333333333',
      }),
    ).rejects.toThrow('Managed connector secret çözülemedi.');
    await expect(
      backend.resolveScoped(first, {
        ...scope,
        connectionId: '44444444-4444-4444-8444-444444444444',
      }),
    ).rejects.toThrow('Managed connector secret çözülemedi.');
    const second = await backend.rotateScoped(
      { ...credentials, consumerSecret: 'cs_second_test_value' },
      scope,
    );
    expect(second).not.toBe(first);
    await expect(backend.resolveScoped(second, scope)).resolves.toMatchObject({
      consumerSecret: 'cs_second_test_value',
    });
    await backend.revoke(second, scope);
    await expect(backend.resolveScoped(second, scope)).rejects.toThrow(
      'Managed connector secret çözülemedi.',
    );
    expect(calls.some((call) => call.includes('/auth/approle/login'))).toBe(
      true,
    );
    expect(calls.some((call) => call.includes('/metadata/connectors/'))).toBe(
      true,
    );
  });

  it('fails closed without exposing upstream error material', async () => {
    const { backend, unavailable } = fixture();
    unavailable();
    const result = await backend
      .createScoped(credentials, scope)
      .catch((error: unknown) => error);
    expect(String(result)).toContain('Managed connector secret kaydedilemedi.');
    expect(String(result)).not.toContain(credentials.consumerSecret);
    await expect(backend.health()).rejects.toThrow(
      'Managed connector secret provider hazır değil.',
    );
  });
});
