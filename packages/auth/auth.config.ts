import { createBetterAuthEngine } from './src/engine.js';

// CLI schema generation only. No connection is opened by createBetterAuth.
const instance = createBetterAuthEngine({
  databaseUrl:
    process.env.DATABASE_URL ??
    'postgres://schema-only:unused@127.0.0.1:5432/shopai',
  baseUrl: 'http://127.0.0.1:4000',
  secret: 'schema-generation-only-not-a-runtime-secret',
  trustedOrigins: ['http://127.0.0.1:3000'],
  sendEmail: async () => {
    throw new Error('Schema generator must never send email');
  },
});

export default instance.auth;
