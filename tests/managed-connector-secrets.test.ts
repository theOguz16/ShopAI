import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ManagedConnectorSecretStore } from '../packages/connectors/src/managed-secrets.js';

const encryptionKey = Buffer.alloc(32, 11).toString('base64');
const wrongEncryptionKey = Buffer.alloc(32, 12).toString('base64');
const credentials = {
  storeUrl: 'https://merchant.example',
  consumerKey: 'ck_encrypted_test_value',
  consumerSecret: 'cs_encrypted_test_value',
};
const roots: string[] = [];

async function privateRoot() {
  const root = await mkdtemp(join(tmpdir(), 'shopai-managed-secrets-'));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('managed connector secret encryption', () => {
  it('encrypts new credentials at rest and resolves them with the same key', async () => {
    const root = await privateRoot();
    const store = new ManagedConnectorSecretStore(root, encryptionKey);
    const reference = await store.create(credentials);
    const key = reference.slice('secret://'.length);
    const raw = await readFile(
      join(root, 'connector-secrets', `${key}.json`),
      'utf8',
    );

    expect(raw).not.toContain(credentials.consumerKey);
    expect(raw).not.toContain(credentials.consumerSecret);
    expect(raw).not.toContain(credentials.storeUrl);
    expect(JSON.parse(raw)).toMatchObject({
      v: 1,
      alg: 'aes-256-gcm',
      iv: expect.any(String),
      tag: expect.any(String),
      ciphertext: expect.any(String),
    });
    await expect(store.resolve(reference)).resolves.toEqual(credentials);
  });

  it('fails closed when an encrypted credential is read with the wrong key', async () => {
    const root = await privateRoot();
    const reference = await new ManagedConnectorSecretStore(
      root,
      encryptionKey,
    ).create(credentials);

    await expect(
      new ManagedConnectorSecretStore(root, wrongEncryptionKey).resolve(
        reference,
      ),
    ).rejects.toThrow('Connector secret çözülemedi.');
  });

  it('keeps legacy plaintext credentials readable for controlled migration', async () => {
    const root = await privateRoot();
    const directory = join(root, 'connector-secrets');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const key = 'ONBOARDING_0123456789ABCDEF0123456789ABCDEF';
    await writeFile(
      join(directory, `${key}.json`),
      JSON.stringify(credentials),
      { encoding: 'utf8', mode: 0o600 },
    );

    await expect(
      new ManagedConnectorSecretStore(root, encryptionKey).resolve(
        `secret://${key}`,
      ),
    ).resolves.toEqual(credentials);
  });
});
