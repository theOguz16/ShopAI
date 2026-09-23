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
    'passes disabled-by-default Better Auth secrets only to the %s API service',
    async (environment) => {
      const compose = await readFile(
        new URL(`../infra/${environment}.compose.yaml`, import.meta.url),
        'utf8',
      );
      const api = compose.split('  api:\n')[1]?.split('  worker:\n')[0];
      const worker = compose.split('  worker:\n')[1]?.split('  web:\n')[0];
      const prefix = environment.toUpperCase();
      expect(api).toContain(
        `BETTER_AUTH_ENABLED: "\${${prefix}_BETTER_AUTH_ENABLED:-false}"`,
      );
      expect(api).toContain(
        `BETTER_AUTH_SECRET: "\${${prefix}_BETTER_AUTH_SECRET:-}"`,
      );
      expect(api).toContain(
        `AUTH_EMAIL_FROM: "\${${prefix}_AUTH_EMAIL_FROM:-}"`,
      );
      expect(worker).not.toContain('BETTER_AUTH_SECRET:');
      expect(worker).not.toContain('AUTH_EMAIL_FROM:');
    },
  );
});
