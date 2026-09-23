import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const plugin = resolve(root, 'infra/woocommerce-vps-no-payments.php');
const seed = resolve(root, 'scripts/woocommerce-vps-seed.php');
const harness = resolve(
  root,
  'tests/fixtures/woocommerce-vps-guard-contract.php',
);
const php = spawnSync('php', ['--version'], { encoding: 'utf8' });

describe.skipIf(php.status !== 0)('WooCommerce no-payment PHP runtime', () => {
  it('parses the real plugin, seed, and contract harness', () => {
    for (const path of [plugin, seed, harness]) {
      const result = spawnSync('php', ['-l', path], { encoding: 'utf8' });
      expect(result.status, `${path}: ${result.stderr}`).toBe(0);
    }
  });

  it('denies checkout/order mail while leaving product and cart routes untouched', () => {
    const result = spawnSync('php', [harness, plugin], {
      encoding: 'utf8',
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('ShopAI no-payment callback contract PASS');
  });
});
