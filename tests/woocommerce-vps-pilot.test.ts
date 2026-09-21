import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const compose = resolve(root, 'infra/woocommerce-vps.compose.yaml');
const guard = readFileSync(
  resolve(root, 'infra/woocommerce-vps-no-payments.php'),
  'utf8',
);
const seed = readFileSync(
  resolve(root, 'scripts/woocommerce-vps-seed.php'),
  'utf8',
);
const docker = spawnSync('docker', ['compose', 'version'], {
  encoding: 'utf8',
});

describe('synthetic WooCommerce VPS pilot guardrails', () => {
  it('blocks classic checkout, Store API checkout, and outbound mail', () => {
    expect(guard).toContain('woocommerce_checkout_process');
    expect(guard).toContain('woocommerce_available_payment_gateways');
    expect(guard).toContain('rest_pre_dispatch');
    expect(guard).toContain('/wc/store/v');
    expect(guard).toContain('pre_wp_mail');
  });

  it('seeds only labelled synthetic products and repairs missing variations', () => {
    expect(seed).toContain("getenv('SHOPAI_DEMO_SEED') !== '1'");
    expect(seed).toContain('$index <= 520');
    expect(seed).toContain('_shopai_pilot_fixture_id');
    expect(seed).toContain('wc_get_product_id_by_sku($variationSku)');
    expect(seed).toContain('[SENTETIK DEMO]');
  });

  it('validates the shell entrypoint syntax', () => {
    const result = spawnSync(
      'bash',
      ['-n', resolve(root, 'scripts/woocommerce-vps-pilot.sh')],
      { encoding: 'utf8' },
    );
    expect(result.status, result.stderr).toBe(0);
  });
});

describe.skipIf(docker.status !== 0)('WooCommerce VPS compose contract', () => {
  it('renders with dummy secrets, loopback-only HTTP and a private DB', () => {
    const env = {
      ...process.env,
      WOO_DB_PASSWORD: 'ci-demo-db-not-a-secret',
      WOO_DB_ROOT_PASSWORD: 'ci-demo-root-not-a-secret',
      WOO_PUBLIC_ORIGIN: 'https://woo-pilot.example.invalid',
      WOO_LOOPBACK_PORT: '18480',
    };
    const result = spawnSync(
      'docker',
      ['compose', '-f', compose, 'config', '--format', 'json'],
      { encoding: 'utf8', env },
    );
    expect(result.status, result.stderr).toBe(0);
    const config = JSON.parse(result.stdout);
    expect(config.name).toBe('shopai-woo-vps-pilot');
    expect(config.services.db.ports).toBeUndefined();
    expect(Object.keys(config.services.db.networks)).toEqual([
      'database-private',
    ]);
    expect(config.services.wordpress.ports[0].host_ip).toBe('127.0.0.1');
    expect(String(config.services.wordpress.ports[0].published)).toBe('18480');
    expect(config.services.wordpress.environment.WOO_PUBLIC_ORIGIN).toBe(
      'https://woo-pilot.example.invalid',
    );
    expect(config.services.wpcli).toBeUndefined();

    const withTools = spawnSync(
      'docker',
      ['compose', '-f', compose, '--profile', 'tools', 'config', '--format', 'json'],
      { encoding: 'utf8', env },
    );
    expect(withTools.status, withTools.stderr).toBe(0);
    expect(JSON.parse(withTools.stdout).services.wpcli.image).toContain(
      'wordpress:cli',
    );
  });

  it('fails closed without required credentials', () => {
    const result = spawnSync(
      'docker',
      ['compose', '-f', compose, 'config', '--quiet'],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          WOO_DB_PASSWORD: '',
          WOO_DB_ROOT_PASSWORD: '',
          WOO_PUBLIC_ORIGIN: '',
        },
      },
    );
    expect(result.status).not.toBe(0);
  });
});
