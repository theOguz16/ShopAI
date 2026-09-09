import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase } from './client.js';
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL gerekli.');
const database = createDatabase(url);
try {
  await migrate(database.db, {
    migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
  });
  console.info('Migration tamamlandı.');
} finally {
  await database.close();
}
