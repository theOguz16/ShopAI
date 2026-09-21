import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/integration/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    testTimeout: 15000,
  },
});
