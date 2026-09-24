import { describe, expect, it } from 'vitest';
import { AwsConnectorSecretBackend } from '../packages/connectors/src/secret-backend.js';

const scope = {
  merchantId: '11111111-1111-4111-8111-111111111111',
  connectionId: '22222222-2222-4222-8222-222222222222',
  provider: 'woocommerce',
};
const credentials = {
  storeUrl: 'https://merchant.example',
  consumerKey: 'ck_aws_test_value',
  consumerSecret: 'cs_aws_test_value',
};

function fixture() {
  const stored = new Map<string, string>();
  const calls: string[] = [];
  let available = true;
  const client = {
    async send(command: unknown) {
      const item = command as {
        constructor: { name: string };
        input: {
          Name?: string;
          SecretId?: string;
          SecretString?: string;
          KmsKeyId?: string;
          RecoveryWindowInDays?: number;
        };
      };
      calls.push(item.constructor.name);
      if (!available) throw new Error(credentials.consumerSecret);
      if (item.constructor.name === 'CreateSecretCommand') {
        stored.set(item.input.Name!, item.input.SecretString!);
        return {};
      }
      if (item.constructor.name === 'GetSecretValueCommand') {
        if (item.input.SecretId === 'shopai/staging/health')
          return { SecretString: 'ready' };
        const value = stored.get(item.input.SecretId!);
        if (!value) throw new Error('ResourceNotFoundException');
        return { SecretString: value };
      }
      if (item.constructor.name === 'DeleteSecretCommand') {
        stored.delete(item.input.SecretId!);
        return {};
      }
      if (item.constructor.name === 'DescribeSecretCommand')
        return { Name: item.input.SecretId };
      throw new Error('Unexpected command');
    },
  };
  const backend = new AwsConnectorSecretBackend(
    {
      region: 'eu-central-1',
      namespace: 'shopai/staging',
      healthSecretId: 'shopai/staging/health',
    },
    client as ConstructorParameters<typeof AwsConnectorSecretBackend>[1],
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

describe('AWS Secrets Manager connector backend contract', () => {
  it('creates, resolves, rotates and revokes opaque scoped references', async () => {
    const { backend, stored, calls } = fixture();
    await backend.health();
    const first = await backend.createScoped(credentials, scope);
    expect(first).toMatch(/^secret:\/\/ONBOARDING_[A-F0-9]{32}$/u);
    expect([...stored.keys()][0]).toContain(
      `/shopai/staging/${scope.merchantId}/${scope.connectionId}/${scope.provider}/`.replace(
        '/shopai',
        'shopai',
      ),
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
    expect(calls).toContain('GetSecretValueCommand');
    expect(calls).toContain('DeleteSecretCommand');
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
