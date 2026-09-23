import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { connectorOnboardingCredentialsSchema } from '@shopai/contracts';

const managedKeyPattern = /^ONBOARDING_[A-F0-9]{32}$/u;
const prefix = 'secret://';
const envelopeVersion = 1 as const;
const algorithm = 'aes-256-gcm' as const;
const aad = Buffer.from('shopai-managed-connector-secret:v1', 'utf8');

export type SecretScope = {
  merchantId: string;
  connectionId: string;
  provider: string;
};

type EncryptedEnvelope = {
  v: 1 | 2;
  alg: typeof algorithm;
  iv: string;
  tag: string;
  ciphertext: string;
};

export class ManagedConnectorSecretStore {
  private readonly encryptionKey: Buffer | null;

  constructor(
    private readonly privateRoot: string,
    encryptionKey = process.env.CONNECTOR_SECRET_ENCRYPTION_KEY,
  ) {
    this.encryptionKey = encryptionKey
      ? decodeEncryptionKey(encryptionKey)
      : null;
  }

  async create(credentials: unknown) {
    if (!this.encryptionKey)
      throw new Error('Connector encryption key gerekli.');
    const parsed = connectorOnboardingCredentialsSchema.parse(credentials);
    const key = `ONBOARDING_${randomBytes(16).toString('hex').toUpperCase()}`;
    const directory = join(this.privateRoot, 'connector-secrets');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const stored = encrypt(JSON.stringify(parsed), this.encryptionKey);
    await writeFile(join(directory, `${key}.json`), JSON.stringify(stored), {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    return `${prefix}${key}`;
  }

  async createScoped(credentials: unknown, scope: SecretScope) {
    if (!this.encryptionKey)
      throw new Error('Connector encryption key gerekli.');
    const parsed = connectorOnboardingCredentialsSchema.parse(credentials);
    const key = `ONBOARDING_${randomBytes(16).toString('hex').toUpperCase()}`;
    const directory = join(this.privateRoot, 'connector-secrets');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const encrypted = encrypt(
      JSON.stringify(parsed),
      this.encryptionKey,
      scope,
    );
    await writeFile(join(directory, `${key}.json`), JSON.stringify(encrypted), {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    return `${prefix}${key}`;
  }

  async resolve(reference: string) {
    const key = managedKey(reference);
    const content = await readFile(
      join(this.privateRoot, 'connector-secrets', `${key}.json`),
      'utf8',
    );
    const stored = JSON.parse(content) as unknown;
    if (isEncryptedEnvelope(stored) && stored.v === 2)
      throw new Error('Scoped connector secret için bağlam gerekli.');
    const plaintext = isEncryptedEnvelope(stored)
      ? JSON.parse(decrypt(stored, this.encryptionKey))
      : stored;
    return connectorOnboardingCredentialsSchema.parse(plaintext);
  }

  async resolveScoped(reference: string, scope: SecretScope) {
    const key = managedKey(reference);
    const content = await readFile(
      join(this.privateRoot, 'connector-secrets', `${key}.json`),
      'utf8',
    );
    const stored = JSON.parse(content) as unknown;
    if (!isEncryptedEnvelope(stored) || stored.v !== 2)
      throw new Error('Scoped connector secret bekleniyor.');
    return connectorOnboardingCredentialsSchema.parse(
      JSON.parse(decrypt(stored, this.encryptionKey, scope)),
    );
  }

  async remove(reference: string) {
    const key = managedKey(reference);
    await rm(join(this.privateRoot, 'connector-secrets', `${key}.json`), {
      force: true,
    });
  }

  static supports(reference: string) {
    if (!reference.startsWith(prefix)) return false;
    return managedKeyPattern.test(reference.slice(prefix.length));
  }
}

function encrypt(
  plaintext: string,
  key: Buffer,
  scope?: SecretScope,
): EncryptedEnvelope {
  const iv = randomBytes(12);
  const cipher = createCipheriv(algorithm, key, iv);
  cipher.setAAD(scope ? scopedAad(scope) : aad);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  return {
    v: scope ? 2 : envelopeVersion,
    alg: algorithm,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

function decrypt(
  envelope: EncryptedEnvelope,
  key: Buffer | null,
  scope?: SecretScope,
) {
  if (!key)
    throw new Error('Encrypted connector secret için encryption key gerekli.');
  try {
    const decipher = createDecipheriv(
      algorithm,
      key,
      Buffer.from(envelope.iv, 'base64'),
    );
    decipher.setAAD(envelope.v === 2 && scope ? scopedAad(scope) : aad);
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new Error('Connector secret çözülemedi.');
  }
}

function isEncryptedEnvelope(value: unknown): value is EncryptedEnvelope {
  if (!value || typeof value !== 'object') return false;
  const envelope = value as Partial<EncryptedEnvelope>;
  return (
    (envelope.v === envelopeVersion || envelope.v === 2) &&
    envelope.alg === algorithm &&
    typeof envelope.iv === 'string' &&
    typeof envelope.tag === 'string' &&
    typeof envelope.ciphertext === 'string'
  );
}

function scopedAad(scope: SecretScope) {
  return Buffer.from(
    `shopai-managed-connector-secret:v2:${scope.merchantId}:${scope.connectionId}:${scope.provider}`,
    'utf8',
  );
}

function decodeEncryptionKey(value: string) {
  const key = Buffer.from(value.trim(), 'base64');
  if (key.length !== 32)
    throw new Error('Connector secret encryption key 32 byte olmalıdır.');
  return key;
}

function managedKey(reference: string) {
  if (!ManagedConnectorSecretStore.supports(reference))
    throw new Error('Geçersiz managed connector secret referansı.');
  return reference.slice(prefix.length);
}
