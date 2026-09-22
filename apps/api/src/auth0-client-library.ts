import * as oidc from 'openid-client';
import type {
  Auth0ClientKind,
  Auth0Config,
  VerifiedIdentity,
} from './auth0-oidc.js';

/** All grant/JWKS/signature/issuer/audience/expiry/nonce/state checks are performed
 * by the maintained OIDC library. This module only enforces ShopAI-specific
 * account and MFA requirements after the library returns verified claims. */
export async function verifyAuth0Grant(
  config: Auth0Config,
  kind: Auth0ClientKind,
  code: string,
  state: string,
  nonce: string,
  verifier: string,
): Promise<VerifiedIdentity> {
  const diagnostic = config.issuer === 'https://auth.auth0-test.example/';
  const stage = (name: string) => {
    if (diagnostic) console.warn('OIDC_MOCK_STAGE', name);
  };
  const client = config.clients[kind];
  stage('begin');
  const configuration = await oidc.discovery(
    new URL(config.issuer),
    client.clientId,
    client.clientSecret,
    oidc.ClientSecretPost(client.clientSecret),
  );
  stage('discovered');
  if (configuration.serverMetadata().issuer !== config.issuer)
    throw new Error('OIDC_INVALID_ISSUER');
  for (const endpoint of [
    configuration.serverMetadata().authorization_endpoint,
    configuration.serverMetadata().token_endpoint,
    configuration.serverMetadata().jwks_uri,
  ]) {
    if (
      typeof endpoint !== 'string' ||
      new URL(endpoint).origin !== new URL(config.issuer).origin ||
      new URL(endpoint).protocol !== 'https:'
    )
      throw new Error('OIDC_INVALID_ENDPOINT');
  }
  stage('metadata_validated');
  const callback = new URL(client.redirectUri);
  callback.searchParams.set('state', state);
  callback.searchParams.set('code', code);
  stage('grant_start');
  const tokens = await oidc.authorizationCodeGrant(configuration, callback, {
    pkceCodeVerifier: verifier,
    expectedNonce: nonce,
    expectedState: state,
    idTokenExpected: true,
  });
  stage('grant_resolved');
  const rawClaims: unknown = tokens.claims();
  stage('claims_read');
  if (!rawClaims || typeof rawClaims !== 'object')
    throw new Error('OIDC_MISSING_CLAIMS');
  const claims = rawClaims as Record<string, unknown>;
  if (
    claims.iss !== config.issuer ||
    (claims.aud !== client.clientId &&
      (!Array.isArray(claims.aud) || !claims.aud.includes(client.clientId)))
  )
    throw new Error('OIDC_WRONG_AUDIENCE');
  if (
    claims.email_verified !== true ||
    typeof claims.sub !== 'string' ||
    !claims.sub ||
    claims.sub.length > 512
  )
    throw new Error('OIDC_EMAIL_UNVERIFIED');
  if (typeof claims.email !== 'string') throw new Error('OIDC_EMAIL_MISSING');
  const email = claims.email.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email))
    throw new Error('OIDC_EMAIL_INVALID');
  const time = claims.auth_time;
  const now = Math.floor(Date.now() / 1000);
  const recent =
    typeof time === 'number' && time <= now + 60 && time >= now - 5 * 60;
  const amr = claims.amr;
  const mfa =
    recent &&
    ((Array.isArray(amr) && amr.includes('mfa')) ||
      claims['https://shopai.example/claims/mfa'] === true);
  stage('identity_verified');
  return {
    issuer: config.issuer,
    subject: claims.sub,
    email,
    emailVerified: true,
    mfa,
    authenticatedAt:
      typeof time === 'number' && time > 0 && time <= now + 60
        ? new Date(time * 1000)
        : null,
  };
}
