import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const fixturePath = new URL(
  '../scripts/shopai-pilot-fixtures.php',
  import.meta.url,
);

describe('WooCommerce pilot fixture generator', () => {
  it('uses the parent attribute keys for variation meta and verifies persistence', async () => {
    const source = await readFile(fixturePath, 'utf8');

    expect(source).toContain(
      '$attribute_keys[$name] = sanitize_title($attribute->get_name());',
    );
    expect(source).toContain("$attribute_keys['Beden'] =>");
    expect(source).toContain("$attribute_keys['Renk'] =>");
    expect(source).toContain(
      'wc_get_product_variation_attributes($variation_id)',
    );
    expect(source).toContain("'variations_without_size' => 0");
  });

  it('fails instead of silently creating the acceptance fixture without images', async () => {
    const source = await readFile(fixturePath, 'utf8');

    expect(source).toContain(
      'GD is required; refusing to generate a fixture with silently missing images.',
    );
    expect(source).not.toContain(
      'Warning: GD is unavailable; image coverage cannot be generated.',
    );
  });
});
