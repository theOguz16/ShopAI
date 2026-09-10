import { defineConfig } from 'drizzle-kit';
export default defineConfig({
  dialect: 'postgresql',
  schema: ['./src/schema.ts', './src/sync-progress.ts'],
  out: './drizzle',
});
