import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: [
      'tests/integration/postgres-redis.test.ts',
      'tests/integration/database.test.ts',
      'tests/integration/tenant-isolation.test.ts',
      'tests/integration/analytics.test.ts',
      'tests/integration/merchant-management.test.ts',
    ],
    setupFiles: ['tests/setup.ts'],
    testTimeout: 15000,
  },
});
