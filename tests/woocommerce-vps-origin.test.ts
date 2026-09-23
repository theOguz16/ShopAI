import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const script = resolve(
  import.meta.dirname,
  '../scripts/woocommerce-vps-pilot.sh',
);
const docker = spawnSync('docker', ['compose', 'version'], {
  encoding: 'utf8',
});

function checkOrigin(origin: string) {
  const directory = mkdtempSync(join(tmpdir(), 'shopai-woo-origin-'));
  const envFile = join(directory, 'pilot.env');
  try {
    writeFileSync(
      envFile,
      [
        'WOO_DB_PASSWORD=ci-dummy-password',
        'WOO_DB_ROOT_PASSWORD=ci-dummy-root-password',
        `WOO_PUBLIC_ORIGIN=${origin}`,
        'WOO_LOOPBACK_PORT=18480',
        '',
      ].join('\n'),
    );
    chmodSync(envFile, 0o600);
    return spawnSync('bash', [script, 'status', envFile], {
      encoding: 'utf8',
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

// The operator script intentionally uses GNU stat and targets an Ubuntu VDS.
describe.skipIf(process.platform !== 'linux' || docker.status !== 0)(
  'WooCommerce VPS public-origin gate',
  () => {
    it.each([
      'http://woo-pilot.example.org',
      'https://giyimeticaret.local',
      'https://127.0.0.1',
      'https://woo-pilot.example.invalid',
      'https://user:password@woo-pilot.example.org',
      'https://woo-pilot.example.org/shop',
    ])('rejects an unsafe origin: %s', (origin) => {
      const result = checkOrigin(origin);
      expect(result.status, result.stderr).toBe(2);
      expect(result.stderr).toContain(
        'WOO_PUBLIC_ORIGIN must be a real public HTTPS domain origin',
      );
    });

    it('allows a syntactically valid HTTPS origin without starting containers', () => {
      const result = checkOrigin('https://woo-pilot.fizyoflow.com');
      expect(result.status, result.stderr).toBe(0);
    });
  },
);
