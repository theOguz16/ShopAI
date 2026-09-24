import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { connectorOnboardingCredentialsSchema } from '@shopai/contracts';
import {
  ManagedConnectorSecretStore,
  type SecretScope,
} from './managed-secrets.js';

export interface ConnectorSecretBackend {
  createScoped(credentials: unknown, scope: SecretScope): Promise<string>;
  resolveScoped(reference: string, scope: SecretScope): Promise<unknown>;
  rotateScoped(credentials: unknown, scope: SecretScope): Promise<string>;
  revoke(reference: string, scope: SecretScope): Promise<void>;
  remove(reference: string, scope: SecretScope): Promise<void>;
  health(): Promise<void>;
}

export type ConnectorSecretBackendConfig = {
  backend: 'file' | 'openbao';
  privateRoot: string;
  encryptionKey?: string;
  address?: string;
  mount?: string;
  roleId?: string;
  secretId?: string;
  secretIdFile?: string;
};

export function createConnectorSecretBackend(
  config: ConnectorSecretBackendConfig,
): ConnectorSecretBackend {
  if (config.backend === 'openbao') {
    if (
      !config.address ||
      !config.mount ||
      !config.roleId ||
      (!config.secretId && !config.secretIdFile)
    )
      throw new Error('OpenBao connector secret yapılandırması eksik.');
    return new OpenBaoConnectorSecretBackend({
      address: config.address,
      mount: config.mount,
      roleId: config.roleId,
      secretId: config.secretId,
      secretIdFile: config.secretIdFile,
    });
  }
  const file = new ManagedConnectorSecretStore(
    config.privateRoot,
    config.encryptionKey,
  );
  return {
    createScoped: (credentials, scope) => file.createScoped(credentials, scope),
    resolveScoped: (reference, scope) => file.resolveScoped(reference, scope),
    rotateScoped: (credentials, scope) => file.createScoped(credentials, scope),
    revoke: async () => undefined,
    remove: (reference) => file.remove(reference),
    health: async () => {
      if (!config.encryptionKey)
        throw new Error('Connector encryption key gerekli.');
    },
  };
}

type OpenBaoConfig = {
  address: string;
  mount: string;
  roleId: string;
  secretId?: string;
  secretIdFile?: string;
};
type OpenBaoFetch = typeof fetch;

export class OpenBaoConnectorSecretBackend implements ConnectorSecretBackend {
  private readonly address: string;
  constructor(
    private readonly config: OpenBaoConfig,
    private readonly request: OpenBaoFetch = fetch,
  ) {
    const url = new URL(config.address);
    if (
      url.protocol !== 'https:' ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    )
      throw new Error('OpenBao HTTPS origin gerekli.');
    if (!/^shopai-(local|staging|production|test)$/u.test(config.mount))
      throw new Error('OpenBao mount geçersiz.');
    this.address = url.origin;
  }

  async createScoped(
    credentials: unknown,
    scope: SecretScope,
  ): Promise<string> {
    const parsed = connectorOnboardingCredentialsSchema.parse(credentials);
    const reference = `secret://ONBOARDING_${randomBytes(16).toString('hex').toUpperCase()}`;
    try {
      await this.call('POST', this.path('data', reference, scope), {
        options: { cas: 0 },
        data: { scope, credentials: parsed },
      });
      return reference;
    } catch {
      throw new Error('Managed connector secret kaydedilemedi.');
    }
  }

  rotateScoped(credentials: unknown, scope: SecretScope): Promise<string> {
    return this.createScoped(credentials, scope);
  }

  async resolveScoped(reference: string, scope: SecretScope): Promise<unknown> {
    try {
      const result = (await this.call(
        'GET',
        this.path('data', reference, scope),
      )) as {
        data?: { data?: { scope?: SecretScope; credentials?: unknown } };
      };
      const payload = result.data?.data;
      if (
        payload?.scope?.merchantId !== scope.merchantId ||
        payload.scope.connectionId !== scope.connectionId ||
        payload.scope.provider !== scope.provider
      )
        throw new Error('scope mismatch');
      return connectorOnboardingCredentialsSchema.parse(payload.credentials);
    } catch {
      throw new Error('Managed connector secret çözülemedi.');
    }
  }

  async revoke(reference: string, scope: SecretScope): Promise<void> {
    await this.remove(reference, scope);
  }

  async remove(reference: string, scope: SecretScope): Promise<void> {
    try {
      await this.call('DELETE', this.path('metadata', reference, scope));
    } catch {
      throw new Error('Managed connector secret iptal edilemedi.');
    }
  }

  async health(): Promise<void> {
    try {
      const result = (await this.call(
        'GET',
        `${this.config.mount}/data/health`,
      )) as {
        data?: { data?: { ready?: boolean } };
      };
      if (result.data?.data?.ready !== true)
        throw new Error('health sentinel invalid');
    } catch {
      throw new Error('Managed connector secret provider hazır değil.');
    }
  }

  private path(
    kind: 'data' | 'metadata',
    reference: string,
    scope: SecretScope,
  ) {
    if (
      !ManagedConnectorSecretStore.supports(reference) ||
      !/^[0-9a-f-]{36}$/iu.test(scope.merchantId) ||
      !/^[0-9a-f-]{36}$/iu.test(scope.connectionId) ||
      !/^[a-z][a-z0-9_]{1,30}$/u.test(scope.provider)
    )
      throw new Error('Geçersiz connector secret kapsamı.');
    return `${this.config.mount}/${kind}/connectors/${scope.merchantId}/${scope.connectionId}/${scope.provider}/${reference.slice(9)}`;
  }

  private async call(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    const secretId = this.config.secretIdFile
      ? (await readFile(this.config.secretIdFile, 'utf8')).trim()
      : this.config.secretId;
    if (!secretId) throw new Error('OpenBao bootstrap credential missing');
    const login = await this.request(`${this.address}/v1/auth/approle/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        role_id: this.config.roleId,
        secret_id: secretId,
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!login.ok) throw new Error('OpenBao login failed');
    const auth = (await login.json()) as { auth?: { client_token?: string } };
    if (!auth.auth?.client_token) throw new Error('OpenBao token missing');
    const response = await this.request(`${this.address}/v1/${path}`, {
      method,
      headers: {
        'x-vault-token': auth.auth.client_token,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error('OpenBao request failed');
    if (method === 'DELETE') return undefined;
    return response.json();
  }
}
