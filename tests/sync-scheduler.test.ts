import { describe, expect, it } from 'vitest';
import { connectionToSyncJob } from '../apps/worker/src/scheduler.js';
import { syncJobSchema } from '../packages/contracts/src/index.js';

const merchantId = '10000000-0000-4000-8000-000000000001';
const connectionId = '20000000-0000-4000-8000-000000000001';

describe('catalog sync scheduler contract', () => {
  it('maps a database connection row to the worker payload', () => {
    const payload = connectionToSyncJob({ id: connectionId, merchantId });

    expect(syncJobSchema.parse(payload)).toEqual({
      connectionId,
      merchantId,
    });
  });

  it('rejects the former scheduler payload instead of silently queueing it', () => {
    expect(() => syncJobSchema.parse({ id: connectionId, merchantId })).toThrow(
      /connectionId/,
    );
  });
});
