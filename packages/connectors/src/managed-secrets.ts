import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { woocommerceOnboardingCredentialsSchema } from '@shopai/contracts';

const managedKeyPattern = /^ONBOARDING_[A-F0-9]{32}$/u;
const prefix = 'secret://';

export class ManagedConnectorSecretStore {
  constructor(private readonly privateRoot: string) {}

  async create(credentials: unknown) {
    const parsed = woocommerceOnboardingCredentialsSchema.parse(credentials);
    const key = `ONBOARDING_${randomBytes(16).toString('hex').toUpperCase()}`;
    const directory = join(this.privateRoot, 'connector-secrets');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(join(directory, `${key}.json`), JSON.stringify(parsed), {
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
    return woocommerceOnboardingCredentialsSchema.parse(JSON.parse(content));
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

function managedKey(reference: string) {
  if (!ManagedConnectorSecretStore.supports(reference))
    throw new Error('Geçersiz managed connector secret referansı.');
  return reference.slice(prefix.length);
}
