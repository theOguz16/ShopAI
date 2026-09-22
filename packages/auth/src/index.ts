import { createBetterAuthEngine } from './engine.js';

export interface BetterAuthConfig {
  databaseUrl: string;
  baseUrl: string;
  secret: string;
  trustedOrigins: string[];
  sendEmail: (message: {
    to: string;
    subject: string;
    url: string;
  }) => Promise<void>;
  onPasswordReset?: (userId: string) => Promise<void>;
}

export interface BetterAuthService {
  handle(request: Request): Promise<Response>;
  verifyCredentialMfa(input: {
    email: string;
    password: string;
    totp?: string;
    backupCode?: string;
  }): Promise<{ id: string; email: string } | null>;
  close(): Promise<void>;
}

/** Keep Better Auth's schema separate from ShopAI's UUID-keyed users/sessions. */
export function createBetterAuth(config: BetterAuthConfig): BetterAuthService {
  const { auth, pool } = createBetterAuthEngine(config);
  const endpoint = (path: string) =>
    new URL(`/v1/auth/better${path}`, config.baseUrl);
  const cookieHeader = (response: Response) =>
    response.headers
      .getSetCookie()
      .map((item) => item.split(';', 1)[0])
      .filter(Boolean)
      .join('; ');
  return {
    handle: (request: Request) => auth.handler(request),
    async verifyCredentialMfa({ email, password, totp, backupCode }) {
      if (Boolean(totp) === Boolean(backupCode)) return null;
      const start = await auth.handler(
        new Request(endpoint('/sign-in/email'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: new URL(config.baseUrl).origin,
          },
          body: JSON.stringify({ email, password }),
        }),
      );
      if (!start.ok) return null;
      const startBody = (await start.json()) as { twoFactorRedirect?: boolean };
      const startCookie = cookieHeader(start);
      if (!startBody.twoFactorRedirect || !startCookie) {
        if (startCookie)
          await auth.api.signOut({
            headers: new Headers({ cookie: startCookie }),
          });
        return null;
      }
      const verified = await auth.handler(
        new Request(
          endpoint(
            backupCode
              ? '/two-factor/verify-backup-code'
              : '/two-factor/verify-totp',
          ),
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Origin: new URL(config.baseUrl).origin,
              Cookie: startCookie,
            },
            body: JSON.stringify({
              code: backupCode ?? totp,
              trustDevice: false,
            }),
          },
        ),
      );
      if (!verified.ok) return null;
      const verifiedCookie = cookieHeader(verified);
      if (!verifiedCookie) return null;
      const headers = new Headers({ cookie: verifiedCookie });
      const session = await auth.api.getSession({ headers });
      try {
        if (
          !session?.user.emailVerified ||
          session.user.email.toLowerCase() !== email.toLowerCase() ||
          !(
            'twoFactorEnabled' in session.user &&
            session.user.twoFactorEnabled === true
          )
        )
          return null;
        return { id: session.user.id, email: session.user.email };
      } finally {
        await auth.api.signOut({ headers });
      }
    },
    close: () => pool.end(),
  };
}
