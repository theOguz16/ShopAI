import { createHash, randomBytes } from 'node:crypto';

export type Auth0ClientKind = 'shopper' | 'merchant';
export type Auth0Client = { clientId: string; clientSecret: string; redirectUri: string };
export type Auth0Config = {
  issuer: string;
  webOrigin: string;
  encryptionKey: Buffer;
  clients: Record<Auth0ClientKind, Auth0Client>;
  databaseConnection?: string;
};
export type VerifiedIdentity = {
  issuer: string;
  subject: string;
  email: string;
  emailVerified: true;
  mfa: boolean;
  authenticatedAt: Date | null;
};

type JsonObject = Record<string, unknown>;
export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
export const randomSecret = () => randomBytes(32).toString('base64url');
const fail = (): never => {
  throw new Error('OIDC_VERIFICATION_FAILED');
};
const object = (value: unknown): JsonObject =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : fail();
const string = (value: unknown): string =>
  typeof value === 'string' && value.length > 0 ? value : fail();
function httpsOrigin(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !url.hostname || url.hostname === 'localhost' || /^[\d.]+$/u.test(url.hostname)) fail();
  return url;
}

/** Fail closed; no default tenant/client/secret, no partial Auth0 configuration. */
export function parseAuth0Config(env: NodeJS.ProcessEnv): Auth0Config | null {
  if (!env.AUTH0_ENABLED || env.AUTH0_ENABLED === 'false') return null;
  if (env.AUTH0_ENABLED !== 'true') fail();
  const issuer = httpsOrigin(string(env.AUTH0_ISSUER)).href;
  const issuerUrl = new URL(issuer);
  if (issuerUrl.pathname !== '/' || issuer !== issuerUrl.origin + '/') fail();
  const webOrigin = httpsOrigin(string(env.AUTH0_WEB_ORIGIN)).origin;
  const key = string(env.AUTH0_TRANSACTION_KEY);
  if (!/^[A-Za-z0-9+/]{43}=$/u.test(key) || Buffer.from(key, 'base64').length !== 32) fail();
  const clients = {} as Record<Auth0ClientKind, Auth0Client>;
  for (const kind of ['shopper', 'merchant'] as const) {
    const prefix = `AUTH0_${kind.toUpperCase()}`;
    const clientId = string(env[`${prefix}_CLIENT_ID`]);
    const clientSecret = string(env[`${prefix}_CLIENT_SECRET`]);
    const redirectUri = string(env[`${prefix}_REDIRECT_URI`]);
    const callback = httpsOrigin(redirectUri);
    if (callback.origin !== issuerUrl.origin && !callback.pathname.startsWith('/v1/auth/oidc/callback/')) fail();
    if (callback.pathname !== `/v1/auth/oidc/callback/${kind}` || callback.search || callback.hash) fail();
    if (clientSecret.length < 32 || clientId === clientSecret) fail();
    clients[kind] = { clientId, clientSecret, redirectUri };
  }
  if (clients.shopper.clientId === clients.merchant.clientId || clients.shopper.redirectUri === clients.merchant.redirectUri) fail();
  return {
    issuer,
    webOrigin,
    encryptionKey: Buffer.from(key, 'base64'),
    clients,
    databaseConnection: env.AUTH0_DATABASE_CONNECTION || undefined,
  };
}

type Discovery = { authorizationEndpoint: string; tokenEndpoint: string; jwksUri: string };
export async function discover(config: Auth0Config): Promise<Discovery> {
  const endpoint = new URL('.well-known/openid-configuration', config.issuer);
  const response = await fetch(endpoint, { signal: AbortSignal.timeout(8000), redirect: 'error' });
  if (!response.ok) fail();
  const data = object(await response.json());
  if (data.issuer !== config.issuer) fail();
  const validate = (value: unknown) => {
    const url = httpsOrigin(string(value));
    if (url.origin !== new URL(config.issuer).origin) fail();
    return url.href;
  };
  return {
    authorizationEndpoint: validate(data.authorization_endpoint),
    tokenEndpoint: validate(data.token_endpoint),
    jwksUri: validate(data.jwks_uri),
  };
}

export function authorizationUrl(
  config: Auth0Config,
  endpoint: string,
  kind: Auth0ClientKind,
  values: { state: string; nonce: string; verifier: string; signup: boolean; stepup: boolean },
) {
  const client = config.clients[kind];
  const url = new URL(endpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', client.clientId);
  url.searchParams.set('redirect_uri', client.redirectUri);
  url.searchParams.set('scope', 'openid profile email');
  url.searchParams.set('state', values.state);
  url.searchParams.set('nonce', values.nonce);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('code_challenge', createHash('sha256').update(values.verifier).digest('base64url'));
  if (values.signup) url.searchParams.set('screen_hint', 'signup');
  if (values.stepup) {
    url.searchParams.set('prompt', 'login');
    url.searchParams.set('max_age', '0');
  }
  return url.href;
}

export async function requestPasswordReset(config: Auth0Config, email: string, kind: Auth0ClientKind = 'shopper'): Promise<void> {
  if (!config.databaseConnection) fail();
  const endpoint = new URL('/dbconnections/change_password', config.issuer);
  const result = await fetch(endpoint, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_id: config.clients[kind].clientId, connection: config.databaseConnection, email }),
    signal: AbortSignal.timeout(8000), redirect: 'error',
  });
  if (!result.ok) fail();
}
