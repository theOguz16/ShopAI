import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('staging container configuration', () => {
  it('binds the web production server to all container interfaces', async () => {
    const manifest = JSON.parse(
      await readFile(
        new URL('../apps/web/package.json', import.meta.url),
        'utf8',
      ),
    ) as { scripts?: { start?: string } };

    expect(manifest.scripts?.start).toContain('--hostname 0.0.0.0');
  });

  it.each(['staging', 'production'] as const)(
    'passes optional Auth0 settings only to the %s API service',
    async (environment) => {
      const compose = await readFile(
        new URL(`../infra/${environment}.compose.yaml`, import.meta.url),
        'utf8',
      );
      const api = compose.split('  api:\n')[1]?.split('  worker:\n')[0];
      const worker = compose.split('  worker:\n')[1]?.split('  web:\n')[0];
      const prefix = environment.toUpperCase();
      expect(api).toContain(
        `AUTH0_ENABLED: "\${${prefix}_AUTH0_ENABLED:-false}"`,
      );
      expect(api).toContain(
        `AUTH_PILOT_LOGIN_ENABLED: "\${${prefix}_AUTH_PILOT_LOGIN_ENABLED:-true}"`,
      );
      for (const name of [
        'ISSUER',
        'WEB_ORIGIN',
        'TRANSACTION_KEY',
        'SHOPPER_CLIENT_ID',
        'SHOPPER_CLIENT_SECRET',
        'SHOPPER_REDIRECT_URI',
        'MERCHANT_CLIENT_ID',
        'MERCHANT_CLIENT_SECRET',
        'MERCHANT_REDIRECT_URI',
        'DATABASE_CONNECTION',
      ]) {
        expect(api).toContain(`AUTH0_${name}: "\${${prefix}_AUTH0_${name}:-}"`);
        expect(worker).not.toContain(`AUTH0_${name}:`);
      }
    },
  );
});
