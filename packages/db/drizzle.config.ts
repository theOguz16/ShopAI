import { defineConfig } from 'drizzle-kit';
export default defineConfig({
  dialect: 'postgresql',
  schema: [
    './src/schema.ts',
    './src/sync-progress.ts',
    './src/product-view-event-repository.ts',
  ],
  out: './drizzle',
});
