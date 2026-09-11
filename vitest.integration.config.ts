import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'tests/integration/postgres-redis.test.ts',
      'tests/integration/database.test.ts',
      'tests/integration/tenant-isolation.test.ts',
      'tests/integration/analytics.test.ts',
      'tests/integration/discovery-session.test.ts',
      'tests/integration/storefront.test.ts',
      'tests/integration/merchant-management.test.ts',
      'tests/integration/merchant-onboarding.test.ts',
      'tests/integration/sync-status.test.ts',
      'tests/integration/product-detail-api.test.ts',
    ],
    fileParallelism: false,
    testTimeout: 30000,
  },
});
