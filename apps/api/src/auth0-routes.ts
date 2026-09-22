import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { Database } from '@shopai/db';
import { userIdentities, users } from '@shopai/db';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { ApiEnv } from './env.js';
import {
  type Auth0ClientKind, type Auth0Config, type VerifiedIdentity,
  authorizationUrl, discover, randomSecret, requestPasswordReset, sha256,
} from './auth0-oidc.js';
import { requireRecentMfa } from './plugins/auth.js';
import { verifyAuth0Grant } from './auth0-client-library.js';

const startSchema = z.object({
  client: z.enum(['shopper', 'merchant']).default('shopper'),
  returnTo: z.string().max(1024).default('/dashboard'),
  signup: z.enum(['true', 'false']).optional(),
  stepup: z.enum(['true', 'false']).optional(),
}).strict();
const claimSchema = z.object({
  client: z.enum(['shopper', 'merchant']),
  returnTo: z.string().max(1024).default('/dashboard'),
  pilotEmail: z.string().email().max(254),
  pilotToken: z.string().min(16).max(256),
}).strict();
const callbackSchema = z.object({
  code: z.string().min(1).max(4096),
  state: z.string().min(40).max(512),
}).passthrough();
const resetSchema = z.object({
  email: z.string().email().max(254),
  client: z.enum(['shopper', 'merchant']).default('shopper'),
}).strict();
const bindingName = (env: ApiEnv) => env.DEPLOY_ENV === 'staging' || env.DEPLOY_ENV === 'production'
  ? '__Host-shopai_oidc_state' : 'shopai_oidc_state';
const attributes = (env: ApiEnv) => `Path=/; HttpOnly; SameSite=Lax${env.DEPLOY_ENV === 'staging' || env.DEPLOY_ENV === 'production' ? '; Secure' : ''}`;
const getCookie = (request: FastifyRequest, name: string) => {
  const matches = request.headers.cookie?.split(';').map((part) => part.trim()).filter((part) => part.startsWith(`${name}=`));
  return matches?.length === 1 ? matches[0]?.slice(name.length + 1) : undefined;
};
const expireBinding = (reply: FastifyReply, env: ApiEnv) =>
  reply.header('Set-Cookie', `${bindingName(env)}=; ${attributes(env)}; Max-Age=0`);
function safeReturnTo(value: string, origin: string): string | null {
  if (!value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u001f]/u.test(value)) return null;
  const target = new URL(value, origin);
  if (target.origin !== origin || target.pathname.startsWith('//') || target.username || target.password) return null;
  return `${target.pathname}${target.search}${target.hash}`;
}
function encrypt(verifier: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(verifier, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
}
function decrypt(encoded: string, key: Buffer): string {
  const data = Buffer.from(encoded, 'base64');
  if (data.length < 30) throw new Error('OIDC_TRANSACTION_INVALID');
  const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
  decipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8');
}
const authError = (reply: FastifyReply) => reply.code(401).send({ code: 'OIDC_AUTHENTICATION_FAILED' });

export function registerAuth0Routes(app: FastifyInstance, db: Database | undefined, env: ApiEnv, config: Auth0Config | null) {
  app.get('/v1/auth/capabilities', async () => ({ auth0Enabled: Boolean(config), pilotEnabled: app.authApi.pilotEnabled }));
  if (!config || !db) return;
  const database = db;
  async function begin(request: FastifyRequest, reply: FastifyReply, input: z.infer<typeof startSchema>, claimUserId: string | null = null) {
    const returnTo = safeReturnTo(input.returnTo, config!.webOrigin);
    if (!returnTo) return reply.code(400).send({ code: 'INVALID_RETURN_TO' });
    if (input.stepup === 'true' && (!request.auth || request.auth.authLevel === 'pilot'))
      return reply.code(401).send({ code: 'UNAUTHENTICATED' });
    const flowKind = input.stepup === 'true' ? 'stepup' : 'login';
    const state = randomSecret();
    const nonce = randomSecret();
    const verifier = randomSecret();
    const binding = randomSecret();
    let authorizationEndpoint: string;
    try { authorizationEndpoint = (await discover(config!)).authorizationEndpoint; }
    catch { return reply.code(503).send({ code: 'IDENTITY_PROVIDER_UNAVAILABLE' }); }
    await database.execute(sql`
      INSERT INTO oidc_auth_transactions
      (state_hash,browser_binding_hash,client_kind,nonce_hash,nonce_ciphertext,pkce_verifier_ciphertext,return_to,expires_at,claim_user_id,stepup_user_id,flow_kind)
      VALUES (${sha256(state)},${sha256(binding)},${input.client},${sha256(nonce)},decode(${encrypt(nonce, config!.encryptionKey)},'base64'),decode(${encrypt(verifier, config!.encryptionKey)},'base64'),
        ${returnTo},${new Date(Date.now() + 5 * 60000)},${claimUserId}::uuid,${flowKind === 'stepup' ? request.auth?.userId : null}::uuid,${flowKind})
    `);
    reply.header('Cache-Control', 'no-store');
    reply.header('Set-Cookie', `${bindingName(env)}=${binding}; ${attributes(env)}; Max-Age=300`);
    return reply.redirect(authorizationUrl(config!, authorizationEndpoint, input.client, {
      state, nonce, verifier, signup: input.signup === 'true', stepup: flowKind === 'stepup',
    }), 303);
  }
  app.get('/v1/auth/oidc/start', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const parsed = startSchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ code: 'INVALID_INPUT' });
    return begin(request, reply, parsed.data);
  });
  app.post('/v1/auth/oidc/claim', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    if (!request.headers.origin || !app.authApi.allowedOrigins.has(request.headers.origin))
      return reply.code(403).send({ code: 'FORBIDDEN_ORIGIN' });
    const parsed = claimSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: 'INVALID_INPUT' });
    const normalized = parsed.data.pilotEmail.trim().toLowerCase();
    if (!app.authApi.verifyPilotCredential(normalized, parsed.data.pilotToken))
      return reply.code(401).send({ code: 'INVALID_CREDENTIALS' });
    const rows = await database.execute(sql`SELECT id FROM users WHERE email = ${normalized} AND account_status = 'pilot'`);
    const id = rows.rows[0]?.id;
    if (typeof id !== 'string') return reply.code(409).send({ code: 'PILOT_ACCOUNT_NOT_FOUND' });
    return begin(request, reply, { client: parsed.data.client, returnTo: parsed.data.returnTo }, id);
  });
  async function resolveAccount(identity: VerifiedIdentity, record: { claimUserId: string | null; stepupUserId: string | null; flowKind: string }, requestId: string) {
    return database.transaction(async (tx) => {
      const [existing] = await tx.select({ userId: userIdentities.userId }).from(userIdentities)
        .where(and(eq(userIdentities.issuer, identity.issuer), eq(userIdentities.subject, identity.subject)));
      let userId: string;
      if (existing) {
        userId = existing.userId;
        const account = await tx.execute(sql`SELECT account_status FROM users WHERE id = ${userId}::uuid FOR UPDATE`);
        if (account.rows[0]?.account_status !== 'active') throw new Error('ACCOUNT_INACTIVE');
        if (record.claimUserId && record.claimUserId !== userId) throw new Error('IDENTITY_CONFLICT');
      } else if (record.claimUserId && record.flowKind === 'login') {
        userId = record.claimUserId;
        const account = await tx.execute(sql`SELECT email,account_status FROM users WHERE id = ${userId}::uuid FOR UPDATE`);
        if (account.rows[0]?.account_status !== 'pilot' || account.rows[0]?.email !== identity.email)
          throw new Error('PILOT_LINK_PROOF_MISMATCH');
        const [already] = await tx.select({ userId: userIdentities.userId }).from(userIdentities)
          .where(and(eq(userIdentities.issuer, identity.issuer), eq(userIdentities.userId, userId)));
        if (already) throw new Error('IDENTITY_CONFLICT');
        await tx.insert(userIdentities).values({ userId, issuer: identity.issuer, subject: identity.subject });
        await tx.execute(sql`UPDATE users SET account_status='active', email_verified_at=now() WHERE id=${userId}::uuid`);
        await tx.execute(sql`UPDATE sessions SET revoked_at=now() WHERE user_id=${userId}::uuid AND auth_level='pilot' AND revoked_at IS NULL`);
        await tx.execute(sql`INSERT INTO auth_audit_events (user_id,event_type,outcome,request_id) VALUES (${userId}::uuid,'identity_link','success',${requestId})`);
      } else {
        if (record.flowKind === 'stepup') throw new Error('STEPUP_IDENTITY_MISMATCH');
        // Email collision is a hard stop. Never upsert or assign an old UUID/role by email.
        const collision = await tx.execute(sql`SELECT 1 FROM users WHERE email=${identity.email} LIMIT 1`);
        if (collision.rows.length) throw new Error('ACCOUNT_LINK_REQUIRED');
        const [created] = await tx.insert(users).values({ email: identity.email }).returning({ id: users.id });
        if (!created) throw new Error('ACCOUNT_CREATION_FAILED');
        userId = created.id;
        await tx.insert(userIdentities).values({ userId, issuer: identity.issuer, subject: identity.subject });
        await tx.execute(sql`UPDATE users SET account_status='active',email_verified_at=now() WHERE id=${userId}::uuid`);
      }
      if (record.stepupUserId) {
        if (record.stepupUserId !== userId || !identity.mfa || !identity.authenticatedAt ||
          Date.now() - identity.authenticatedAt.getTime() > 5 * 60000)
          throw new Error('STEPUP_IDENTITY_MISMATCH');
      }
      await tx.execute(sql`INSERT INTO auth_audit_events (user_id,event_type,outcome,request_id) VALUES (${userId}::uuid,${record.stepupUserId ? 'mfa' : 'login'},'success',${requestId})`);
      return userId;
    });
  }
  app.get('/v1/auth/oidc/callback/:kind', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const kind = (request.params as { kind?: string }).kind;
    const parsed = callbackSchema.safeParse(request.query);
    const binding = getCookie(request, bindingName(env));
    if ((kind !== 'shopper' && kind !== 'merchant') || !parsed.success || !binding || !/^[A-Za-z0-9_-]{43}$/u.test(binding))
      return authError(reply);
    const recordResult = await database.execute(sql`
      WITH pending AS MATERIALIZED (
        SELECT state_hash, nonce_ciphertext, pkce_verifier_ciphertext
        FROM oidc_auth_transactions
        WHERE state_hash=${sha256(parsed.data.state)} AND browser_binding_hash=${sha256(binding)}
          AND client_kind=${kind} AND consumed_at IS NULL AND expires_at>now()
        FOR UPDATE
      )
      UPDATE oidc_auth_transactions AS t
      SET consumed_at=now(), nonce_ciphertext=decode('','hex'), pkce_verifier_ciphertext=decode('','hex')
      FROM pending WHERE t.state_hash=pending.state_hash
      RETURNING t.nonce_hash, encode(pending.nonce_ciphertext,'base64') AS encrypted_nonce,
        encode(pending.pkce_verifier_ciphertext,'base64') AS encrypted_verifier,
        t.return_to, t.claim_user_id, t.stepup_user_id, t.flow_kind
    `);
    const record = recordResult.rows[0];
    expireBinding(reply, env);
    if (!record) return authError(reply);
    try {
      const verifier = decrypt(String(record.encrypted_verifier), config.encryptionKey);
      const nonce = decrypt(String(record.encrypted_nonce), config.encryptionKey);
      if (sha256(nonce) !== String(record.nonce_hash)) throw new Error('OIDC_NONCE_MISMATCH');
      const identity = await verifyAuth0Grant(config, kind as Auth0ClientKind, parsed.data.code, parsed.data.state, nonce, verifier);
      const userId = await resolveAccount(identity, {
        claimUserId: typeof record.claim_user_id === 'string' ? record.claim_user_id : null,
        stepupUserId: typeof record.stepup_user_id === 'string' ? record.stepup_user_id : null,
        flowKind: String(record.flow_kind),
      }, request.id);
      if (record.stepup_user_id && request.auth?.sessionId)
        await database.execute(sql`UPDATE sessions SET revoked_at=now() WHERE id=${request.auth.sessionId}::uuid AND user_id=${userId}::uuid`);
      await app.authApi.issueOidcSession(userId, kind as Auth0ClientKind, identity.mfa ? 'mfa' : 'password', identity.authenticatedAt, reply);
      return reply.redirect(`${config.webOrigin}${String(record.return_to)}`, 303);
    } catch {
      return authError(reply);
    }
  });
  app.post('/v1/auth/recover', {
    config: { rateLimit: { max: 3, timeWindow: '5 minutes' } },
  }, async (request, reply) => {
    if (!request.headers.origin || !app.authApi.allowedOrigins.has(request.headers.origin))
      return reply.code(403).send({ code: 'FORBIDDEN_ORIGIN' });
    const parsed = resetSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: 'INVALID_INPUT' });
    // Generic response: do not reveal whether an account exists.
    try { await requestPasswordReset(config, parsed.data.email.trim().toLowerCase(), parsed.data.client); }
    catch { /* never reflect provider details */ }
    return reply.code(202).send({ ok: true });
  });
  app.post('/v1/auth/logout-all', async (request, reply) => app.authApi.logoutAll(request, reply));
  app.post('/v1/auth/account/close', { preHandler: requireRecentMfa }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ code: 'UNAUTHENTICATED' });
    const userId = request.auth.userId;
    const outcome = await database.transaction(async (tx) => {
      const account = await tx.execute(sql`SELECT account_status FROM users WHERE id=${userId}::uuid FOR UPDATE`);
      if (account.rows[0]?.account_status !== 'active') return 'ACCOUNT_INACTIVE';
      const owner = await tx.execute(sql`SELECT 1 FROM memberships WHERE user_id=${userId}::uuid AND role='owner' LIMIT 1`);
      if (owner.rows.length) return 'OWNER_TRANSFER_REQUIRED';
      await tx.execute(sql`UPDATE users SET account_status='closed',closed_at=now() WHERE id=${userId}::uuid`);
      await tx.execute(sql`UPDATE sessions SET revoked_at=now() WHERE user_id=${userId}::uuid AND revoked_at IS NULL`);
      await tx.execute(sql`INSERT INTO auth_audit_events (user_id,event_type,outcome,request_id) VALUES (${userId}::uuid,'account_closing','success',${request.id})`);
      return 'OK';
    });
    if (outcome !== 'OK') return reply.code(409).send({ code: outcome });
    return app.authApi.logout(request, reply);
  });
}
