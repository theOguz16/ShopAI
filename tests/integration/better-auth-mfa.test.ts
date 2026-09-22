import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createBetterAuth } from '../../packages/auth/src/index.js';
import { createDatabase } from '../../packages/db/src/client.js';
import { testTotp } from '../helpers/totp.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl)
  throw new Error('Better Auth MFA integration requires PostgreSQL');
const apiOrigin = 'https://api.better-auth-test.example';
const email = `better-auth-${randomUUID()}@example.invalid`;
const password = 'test-only-strong-password-123456';
const database = createDatabase(databaseUrl);
const sent: string[] = [];
const auth = createBetterAuth({
  databaseUrl,
  baseUrl: apiOrigin,
  secret: 'test-only-better-auth-secret-1234567890',
  trustedOrigins: [apiOrigin],
  sendEmail: async ({ url }) => {
    sent.push(url);
  },
});

async function post(path: string, body: unknown, cookie?: string) {
  return auth.handle(
    new Request(`${apiOrigin}/v1/auth/better/${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: apiOrigin,
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
}

function cookies(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((item) => item.split(';', 1)[0])
    .join('; ');
}

describe('Better Auth gerçek PostgreSQL MFA kabulü', () => {
  afterAll(async () => {
    await database.db.execute(
      sql`DELETE FROM shopai_auth."user" WHERE email = ${email}`,
    );
    await auth.close();
    await database.close();
  });

  it('doğrulanmış e-posta ve TOTP olmadan ShopAI oturumu kanıtı üretmez', async () => {
    const signup = await post('sign-up/email', {
      name: 'Test Merchant',
      email,
      password,
    });
    expect(signup.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(
      await auth.verifyCredentialMfa({ email, password, totp: '000000' }),
    ).toBeNull();

    const verified = await auth.handle(new Request(sent[0]!));
    expect(verified.status).toBeLessThan(400);
    const signIn = await post('sign-in/email', { email, password });
    expect(signIn.status).toBe(200);
    const sessionCookie = cookies(signIn);
    expect(sessionCookie).toContain('session_token=');
    expect(
      await auth.verifyCredentialMfa({ email, password, totp: '000000' }),
    ).toBeNull();

    const enrollment = await post(
      'two-factor/enable',
      { password, method: 'totp' },
      sessionCookie,
    );
    expect(enrollment.status).toBe(200);
    const payload = (await enrollment.json()) as {
      totpURI?: string;
      backupCodes?: string[];
    };
    expect(payload.totpURI).toBeDefined();
    const secret = new URL(payload.totpURI!).searchParams.get('secret');
    expect(secret).toBeTruthy();
    const confirm = await post(
      'two-factor/verify-totp',
      { code: testTotp(secret!, -1) },
      sessionCookie,
    );
    expect(confirm.status).toBe(200);
    expect(
      await auth.verifyCredentialMfa({ email, password, totp: '000000' }),
    ).toBeNull();
    expect(
      await auth.verifyCredentialMfa({
        email,
        password,
        totp: testTotp(secret!),
      }),
    ).toMatchObject({ email });
    const backupCode = payload.backupCodes?.[0];
    expect(backupCode).toBeTruthy();
    expect(
      await auth.verifyCredentialMfa({ email, password, backupCode }),
    ).toMatchObject({ email });
    expect(
      await auth.verifyCredentialMfa({ email, password, backupCode }),
    ).toBeNull();
  });
});
