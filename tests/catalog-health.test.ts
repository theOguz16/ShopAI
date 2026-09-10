import { describe, expect, it } from 'vitest';
import {
  CATALOG_CONNECTION_STALE_AFTER_MS,
  catalogConnectionHealth,
} from '../packages/commerce/src/catalog-health.js';

describe('catalog connection health', () => {
  const now = new Date('2026-09-10T12:00:00.000Z').getTime();

  it('marks a recent successful active connection healthy', () => {
    expect(
      catalogConnectionHealth(
        {
          active: true,
          authorizationStatus: 'active',
          lastSuccessfulSyncAt: new Date(now - 5 * 60_000),
          lastSyncError: null,
        },
        now,
      ),
    ).toBe('healthy');
  });

  it('marks a connection stale after the operational 30-minute window', () => {
    expect(
      catalogConnectionHealth(
        {
          active: true,
          authorizationStatus: 'active',
          lastSuccessfulSyncAt: new Date(
            now - CATALOG_CONNECTION_STALE_AFTER_MS - 1,
          ),
          lastSyncError: null,
        },
        now,
      ),
    ).toBe('stale');
  });

  it('marks authorization or sync errors as requiring attention', () => {
    expect(
      catalogConnectionHealth(
        {
          active: true,
          authorizationStatus: 'reauthorization_required',
          lastSuccessfulSyncAt: new Date(now - 5 * 60_000),
          lastSyncError: null,
        },
        now,
      ),
    ).toBe('attention');
    expect(
      catalogConnectionHealth(
        {
          active: true,
          authorizationStatus: 'active',
          lastSuccessfulSyncAt: new Date(now - 5 * 60_000),
          lastSyncError: 'upstream failed',
        },
        now,
      ),
    ).toBe('attention');
  });

  it('keeps a never-synced active connection pending', () => {
    expect(
      catalogConnectionHealth(
        {
          active: true,
          authorizationStatus: 'pending',
          lastSuccessfulSyncAt: null,
          lastSyncError: null,
        },
        now,
      ),
    ).toBe('pending');
  });
});
