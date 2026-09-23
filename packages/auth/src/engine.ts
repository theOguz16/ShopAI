import { betterAuth } from 'better-auth';
import { twoFactor } from 'better-auth/plugins';
import { Pool } from 'pg';
import type { BetterAuthConfig } from './index.js';

export function createBetterAuthEngine(config: BetterAuthConfig) {
  const pool = new Pool({
    connectionString: config.databaseUrl,
    options: '-c search_path=shopai_auth',
  });
  const auth = betterAuth({
    appName: 'ShopAI',
    baseURL: config.baseUrl,
    basePath: '/v1/auth/better',
    secret: config.secret,
    trustedOrigins: config.trustedOrigins,
    database: pool,
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await config.sendEmail({
          to: user.email,
          subject: 'ShopAI şifre sıfırlama',
          url,
        });
      },
      onPasswordReset: async ({ user }) => {
        await config.onPasswordReset?.(user.id);
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      sendVerificationEmail: async ({ user, url }) => {
        await config.sendEmail({
          to: user.email,
          subject: 'ShopAI e-posta doğrulama',
          url,
        });
      },
    },
    session: {
      expiresIn: 12 * 60 * 60,
      disableSessionRefresh: true,
    },
    plugins: [twoFactor()],
  });
  return { auth, pool };
}
