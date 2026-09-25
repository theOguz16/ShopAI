import { describe, expect, it } from 'vitest';
import { connectionToSyncJob } from '../apps/worker/src/scheduler.js';
import {
  IMPORT_QUEUE,
  type SourceRow,
  SYNC_QUEUE,
  syncJobSchema,
} from '../packages/contracts/src/index.js';

const merchantId = '10000000-0000-4000-8000-000000000001';
const connectionId = '20000000-0000-4000-8000-000000000001';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

describe('catalog sync scheduler contract', () => {
  it('maps a database connection row to a reference-only worker payload', () => {
    const payload = connectionToSyncJob({ id: connectionId, merchantId });

    expect(Object.keys(payload).sort()).toEqual([
      'connectionId',
      'merchantId',
      'syncRunId',
    ]);
    expect(payload.merchantId).toBe(merchantId);
    expect(payload.connectionId).toBe(connectionId);
    expect(payload.syncRunId).toMatch(UUID_RE);
    expect(syncJobSchema.parse(payload)).toEqual(payload);
  });

  it('emits a distinct durable run id per scheduled sync', () => {
    const first = connectionToSyncJob({ id: connectionId, merchantId });
    const second = connectionToSyncJob({ id: connectionId, merchantId });
    expect(first.syncRunId).not.toBe(second.syncRunId);
  });

  it('rejects the former scheduler payload instead of silently queueing it', () => {
    expect(() => syncJobSchema.parse({ id: connectionId, merchantId })).toThrow(
      /connectionId/,
    );
  });
});

describe('sync queue payload contract (ÜRÜN-007)', () => {
  it('carries no catalog rows: the strict schema rejects any extra field', () => {
    const sourceRow: SourceRow = {
      externalId: 'v-1',
      productKey: 'p-1',
      title: 'Ürün',
      description: '',
      category: 'tshirt',
      imageUrl: null,
      imageAlt: null,
      size: 'M',
      color: 'black',
      priceMinor: 1000,
      currency: 'TRY',
      available: true,
      checkoutUrl: 'https://shop.example/p/1',
    };
    const bloated = {
      merchantId,
      connectionId,
      syncRunId: '30000000-0000-4000-8000-000000000001',
      rows: [sourceRow],
      cursor: 'page-7',
    };
    expect(() => syncJobSchema.parse(bloated)).toThrow();
    const serialized = JSON.stringify(
      syncJobSchema.parse({
        merchantId,
        connectionId,
        syncRunId: '30000000-0000-4000-8000-000000000001',
      }),
    );
    expect(serialized.length).toBeLessThan(512);
  });

  it('carries no credential material: only uuid references are serializable', () => {
    const payload = syncJobSchema.parse({
      merchantId,
      connectionId,
      syncRunId: '30000000-0000-4000-8000-000000000001',
    });
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain('secret://');
    expect(serialized).not.toMatch(
      /consumerKey|consumerSecret|apiKey|apiSecret/iu,
    );
  });

  it('keeps the import queue name separate from the sync queue', () => {
    expect(IMPORT_QUEUE).toBe('catalog-import');
    expect(SYNC_QUEUE).toBe('catalog-sync');
  });
});
