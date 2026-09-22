import { createHash, createPublicKey, randomBytes, timingSafeEqual, verify } from 'node:crypto';

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
const same = (a: string, b: string): boolean => {
  const left = Buffer.from(sha256(a), 'hex');
  const right = Buffer.from(sha256(b), 'hex');
  return timingSafeEqual(left, right);
};
function httpsOrigin(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !url.hostname || url.hostname === 'localhost' || /^[\d.]+$/u.test(url.hostname)) fail();
  return url;
}

/** Fail closed; no default tenant/client/secret, no partial Auth0 configuration. */
export function parseAuth0Config(env: NodeJS.ProcessEnv): Auth0Config | null {
  if (env.AUTH0_ENABLED !== 'true') return null;
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

function validateIdToken(
  token: string,
  jwks: JsonObject,
  config: Auth0Config,
  kind: Auth0ClientKind,
  nonceHash: string,
  accessToken?: string,
): VerifiedIdentity {
  if (token.length > 24_000) fail();
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/u.test(part))) fail();
  const header = object(JSON.parse(Buffer.from(parts[0]!, 'base64url').toString('utf8')));
  const claims = object(JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')));
  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || header.kid.length > 256 || header.crit !== undefined || (header.typ !== undefined && header.typ !== 'JWT')) fail();
  const keys = jwks.keys;
  if (!Array.isArray(keys) || keys.length > 50) fail();
  const matches = keys.filter((candidate: unknown) => {
    const key = object(candidate);
    return key.kid === header.kid && key.kty === 'RSA' && (!key.use || key.use === 'sig') && (!key.alg || key.alg === 'RS256');
  });
  if (matches.length !== 1) fail();
  let signatureValid = false;
  try {
    signatureValid = verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key: matches[0] as JsonWebKey, format: 'jwk' }), Buffer.from(parts[2]!, 'base64url'));
  } catch { fail(); }
  if (!signatureValid) fail();
  const now = Math.floor(Date.now() / 1000);
  const clientId = config.clients[kind].clientId;
  const aud = claims.aud;
  if (claims.iss !== config.issuer || (typeof aud !== 'string' && !Array.isArray(aud)) || !(typeof aud === 'string' ? aud === clientId : aud.includes(clientId))) fail();
  if (Array.isArray(aud) && aud.length > 1 && claims.azp !== clientId) fail();
  if (typeof claims.exp !== 'number' || claims.exp <= now - 30 || typeof claims.iat !== 'number' || claims.iat > now + 60 || claims.iat < now - 86400) fail();
  if (claims.nbf !== undefined && (typeof claims.nbf !== 'number' || claims.nbf > now + 60)) fail();
  if (typeof claims.nonce !== 'string' || !same(sha256(claims.nonce), nonceHash)) fail();
  if (claims.email_verified !== true) fail();
  const subject = string(claims.sub);
  const email = string(claims.email).trim().toLowerCase();
  if (subject.length > 512 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) fail();
  if (claims.at_hash !== undefined) {
    if (!accessToken || typeof claims.at_hash !== 'string' || !same(createHash('sha256').update(accessToken).digest().subarray(0, 16).toString('base64url'), claims.at_hash)) fail();
  }
  const authTime = claims.auth_time;
  if (authTime !== undefined && (typeof authTime !== 'number' || authTime > now + 60 || authTime < now - 86400)) fail();
  const amr = claims.amr;
  const mfa = Array.isArray(amr) && amr.includes('mfa') && typeof authTime === 'number' && authTime <= now + 60;
  return {
    issuer: config.issuer,
    subject,
    email,
    emailVerified: true,
    mfa,
    authenticatedAt: typeof authTime === 'number' ? new Date(authTime * 1000) : null,
  };
}

export async function exchangeAndVerify(
  config: Auth0Config,
  discovery: Discovery,
  kind: Auth0ClientKind,
  code: string,
  verifier: string,
  nonceHash: string,
): Promise<VerifiedIdentity> {
  const client = config.clients[kind];
  const body = new URLSearchParams({
    grant_type: 'authorization_code', code, code_verifier: verifier,
    redirect_uri: client.redirectUri, client_id: client.clientId, client_secret: client.clientSecret,
  });
  const tokenResponse = await fetch(discovery.tokenEndpoint, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body, signal: AbortSignal.timeout(8000), redirect: 'error',
  });
  if (!tokenResponse.ok) fail();
  const token = object(await tokenResponse.json());
  if (token.token_type !== 'Bearer') fail();
  const idToken = string(token.id_token);
  const jwksResponse = await fetch(discovery.jwksUri, { signal: AbortSignal.timeout(8000), redirect: 'error' });
  if (!jwksResponse.ok) fail();
  return validateIdToken(idToken, object(await jwksResponse.json()), config, kind, nonceHash, typeof token.access_token === 'string' ? token.access_token : undefined);
}

export async function requestPasswordReset(config: Auth0Config, email: string): Promise<void> {
  if (!config.databaseConnection) fail();
  const endpoint = new URL('/dbconnections/change_password', config.issuer);
  const result = await fetch(endpoint, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_id: config.clients.shopper.clientId, connection: config.databaseConnection, email }),
    signal: AbortSignal.timeout(8000), redirect: 'error',
  });
  if (!result.ok) fail();
}
