import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('merchant session funnel migration', () => {
  it('keeps the tenant-bound funnel aggregation behind a security-definer function', async () => {
    const migration = await readFile(
      new URL(
        '../packages/db/drizzle/0028_merchant_session_funnel.sql',
        import.meta.url,
      ),
      'utf8',
    );

    expect(migration).toContain('FUNCTION merchant_session_funnel');
    expect(migration).toContain('SECURITY DEFINER');
    expect(migration).toContain("current_setting('app.tenant_id'");
    expect(migration).toContain("rc.classification = 'human'");
    expect(migration).toContain("co.status <> 'cancelled'");
    expect(migration).toContain('GRANT EXECUTE');
    expect(migration).not.toContain(
      'GRANT EXECUTE ON FUNCTION merchant_session_funnel(uuid, timestamptz, timestamptz) TO shopai_public',
    );
  });
});
