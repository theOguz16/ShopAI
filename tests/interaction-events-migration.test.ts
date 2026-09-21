import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('interaction event migration', () => {
  it('creates an append-only, tenant-readable and idempotent event store', async () => {
    const migration = await readFile(
      new URL(
        '../packages/db/drizzle/0027_interaction_events.sql',
        import.meta.url,
      ),
      'utf8',
    );
    expect(migration).toContain('CREATE TABLE "interaction_events"');
    expect(migration).toContain('interaction_events_event_key_unique');
    expect(migration).toContain(
      'GRANT SELECT, INSERT ON interaction_events TO shopai_public',
    );
    expect(migration).toContain('public_interaction_events_select');
    expect(migration).toContain('FORCE ROW LEVEL SECURITY');
    expect(migration).not.toContain('GRANT UPDATE');
    expect(migration).not.toContain('GRANT DELETE');
  });
});
