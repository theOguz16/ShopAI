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
});
