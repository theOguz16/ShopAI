import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema.js';
export function createDatabase(
  url: string,
  options: { applicationName?: string } = {},
) {
  const pool = new Pool({
    connectionString: url,
    max: 5,
    connectionTimeoutMillis: 5000,
    application_name: options.applicationName ?? 'shopai-api',
  });
  return { db: drizzle(pool, { schema }), close: () => pool.end() };
}
export type Database = ReturnType<typeof createDatabase>['db'];
