import { defineConfig } from 'drizzle-kit';
export default defineConfig({
  dialect: 'postgresql',
  schema: [
    './src/schema.ts',
    './src/sync-progress.ts',
    './src/product-view-event-repository.ts',
    './src/anonymous-shopping-profile-repository.ts',
    './src/saved-product-repository.ts',
  ],
  out: './drizzle',
});
