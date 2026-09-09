import { describe, expect, it } from 'vitest';
import {
  STOCK_STALE_AFTER_MS,
  stockStatus,
} from '../packages/commerce/src/index.js';
import { stockStatusLabel } from '../packages/contracts/src/index.js';

describe('stock status contract', () => {
  const now = Date.parse('2026-09-09T12:00:00.000Z');
  const fresh = new Date(now - 60_000).toISOString();

  it.each([
    [true, fresh, 'in_stock', 'Stokta'],
    [false, fresh, 'out_of_stock', 'Stok yok'],
    [null, fresh, 'unknown', 'Stok bilgisi bilinmiyor'],
    [
      true,
      new Date(now - STOCK_STALE_AFTER_MS - 1).toISOString(),
      'stale',
      'Stok bilgisi eski; güncel durum bilinmiyor',
    ],
  ] as const)(
    '%s availability becomes %s',
    (available, observedAt, status, label) => {
      const resolved = stockStatus(available, observedAt, now);
      expect(resolved).toBe(status);
      expect(stockStatusLabel(resolved)).toBe(label);
    },
  );

  it('does not infer availability without a verified observation', () => {
    expect(stockStatus(true, null, now)).toBe('unknown');
    expect(stockStatusLabel(stockStatus(true, null, now))).not.toMatch(
      /^(Stokta|Stok yok)$/u,
    );
  });
});
