import { randomBytes } from 'node:crypto';
import {
  CreateSecretCommand,
  DeleteSecretCommand,
  GetSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
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
  backend: 'file' | 'aws';
  privateRoot: string;
  encryptionKey?: string;
  region?: string;
  namespace?: string;
  healthSecretId?: string;
  kmsKeyId?: string;
};

export function createConnectorSecretBackend(
  config: ConnectorSecretBackendConfig,
): ConnectorSecretBackend {
  if (config.backend === 'aws') {
    if (!config.region || !config.namespace || !config.healthSecretId)
      throw new Error('AWS connector secret yapılandırması eksik.');
    return new AwsConnectorSecretBackend({
      region: config.region,
      namespace: config.namespace,
      healthSecretId: config.healthSecretId,
      kmsKeyId: config.kmsKeyId,
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
    revoke: async () => undefined, // PostgreSQL revocation immediately blocks use; local file is retained for rollback.
    remove: (reference) => file.remove(reference),
    health: async () => {
      if (!config.encryptionKey)
        throw new Error('Connector encryption key gerekli.');
    },
  };
}

type AwsConfig = {
  region: string;
  namespace: string;
  healthSecretId: string;
  kmsKeyId?: string;
};
type AwsClient = Pick<SecretsManagerClient, 'send'>;

export class AwsConnectorSecretBackend implements ConnectorSecretBackend {
  private readonly client: AwsClient;
  constructor(
    private readonly config: AwsConfig,
    client?: AwsClient,
  ) {
    this.client =
      client ??
      new SecretsManagerClient({ region: config.region, maxAttempts: 2 });
  }

  async createScoped(
    credentials: unknown,
    scope: SecretScope,
  ): Promise<string> {
    const parsed = connectorOnboardingCredentialsSchema.parse(credentials);
    const reference = `secret://ONBOARDING_${randomBytes(16).toString('hex').toUpperCase()}`;
    const name = this.name(reference, scope);
    try {
      await this.client.send(
        new CreateSecretCommand({
          Name: name,
          SecretString: JSON.stringify({ scope, credentials: parsed }),
          ...(this.config.kmsKeyId ? { KmsKeyId: this.config.kmsKeyId } : {}),
          Tags: [
            {
              Key: 'shopai-environment',
              Value: this.config.namespace.split('/')[1],
            },
            { Key: 'shopai-provider', Value: scope.provider },
          ],
        }),
      );
      return reference;
    } catch {
      throw new Error('Managed connector secret kaydedilemedi.');
    }
  }

  rotateScoped(credentials: unknown, scope: SecretScope) {
    return this.createScoped(credentials, scope);
  }

  async resolveScoped(reference: string, scope: SecretScope): Promise<unknown> {
    try {
      const result = await this.client.send(
        new GetSecretValueCommand({ SecretId: this.name(reference, scope) }),
      );
      if (!result.SecretString) throw new Error('empty');
      const payload = JSON.parse(result.SecretString) as {
        scope?: SecretScope;
        credentials?: unknown;
      };
      if (
        payload.scope?.merchantId !== scope.merchantId ||
        payload.scope?.connectionId !== scope.connectionId ||
        payload.scope?.provider !== scope.provider
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
      await this.client.send(
        new DeleteSecretCommand({
          SecretId: this.name(reference, scope),
          RecoveryWindowInDays: 7,
        }),
      );
    } catch {
      throw new Error('Managed connector secret iptal edilemedi.');
    }
  }

  async health(): Promise<void> {
    try {
      const result = await this.client.send(
        new GetSecretValueCommand({ SecretId: this.config.healthSecretId }),
      );
      if (!result.SecretString) throw new Error('health secret empty');
    } catch {
      throw new Error('Managed connector secret provider hazır değil.');
    }
  }

  private name(reference: string, scope: SecretScope) {
    if (
      !ManagedConnectorSecretStore.supports(reference) ||
      !/^[0-9a-f-]{36}$/iu.test(scope.merchantId) ||
      !/^[0-9a-f-]{36}$/iu.test(scope.connectionId) ||
      !/^[a-z][a-z0-9_]{1,30}$/u.test(scope.provider)
    )
      throw new Error('Geçersiz connector secret kapsamı.');
    return `${this.config.namespace}/${scope.merchantId}/${scope.connectionId}/${scope.provider}/${reference.slice(9)}`;
  }
}
