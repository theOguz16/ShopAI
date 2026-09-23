import { describe, expect, it } from 'vitest';
import { isDesignReferenceAllowed } from '../apps/web/lib/design-reference';

// ÜRÜN-019: /design referans rotası production'da kapalı olmalı
// (dev/staging-only). Kural tek saf fonksiyonda yaşar; middleware onu kullanır.
describe('design reference route gating', () => {
  it('production ortamında izin vermez', () => {
    expect(isDesignReferenceAllowed('production')).toBe(false);
  });

  it('staging ve tanımsız (yerel geliştirme) ortamda izin verir', () => {
    expect(isDesignReferenceAllowed('staging')).toBe(true);
    expect(isDesignReferenceAllowed(undefined)).toBe(true);
  });
});
