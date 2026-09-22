import { readFileSync, writeFileSync } from 'node:fs';

// Strict one-time branch patch. Abort if the inspected source changed.
function change(file, before, after) {
  const source = readFileSync(file, 'utf8');
  if (!source.includes(before) || source.indexOf(before) !== source.lastIndexOf(before))
    throw new Error(`Source mismatch: ${file}`);
  writeFileSync(file, source.replace(before, after));
}
function between(file, start, end, after) {
  const source = readFileSync(file, 'utf8');
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  if (a < 0 || b < 0 || source.indexOf(start, a + 1) >= 0)
    throw new Error(`Source range mismatch: ${file}`);
  writeFileSync(file, source.slice(0, a) + after + source.slice(b));
}
const route = 'apps/api/src/auth0-routes.ts';
const oidc = 'apps/api/src/auth0-oidc.ts';
const auth = 'apps/api/src/plugins/auth.ts';
const app = 'apps/api/src/app.ts';
const env = 'apps/api/src/env.ts';
const migration = 'packages/db/drizzle/0032_auth0_verified_link.sql';
const journal = 'packages/db/drizzle/meta/_journal.json';
const ln = (lines) => `${lines.join('\n')}\n`;

change(route, "import { requireRecentMfa } from './plugins/auth.js';", "import { requireRecentMfa } from './plugins/auth.js';\nimport { verifyAuth0Grant } from './auth0-client-library.js';");
change(route, 'authorizationUrl, discover, exchangeAndVerify, randomSecret, requestPasswordReset, sha256,', 'authorizationUrl, discover, randomSecret, requestPasswordReset, sha256,');
between(route, '  const audit = (userId: string | null, eventType: string, outcome: string, requestId: string) =>', '  async function begin(', '');
change(route,
  '(state_hash,browser_binding_hash,client_kind,nonce_hash,pkce_verifier_ciphertext,return_to,expires_at,claim_user_id,stepup_user_id,flow_kind)',
  '(state_hash,browser_binding_hash,client_kind,nonce_hash,nonce_ciphertext,pkce_verifier_ciphertext,return_to,expires_at,claim_user_id,stepup_user_id,flow_kind)');
change(route,
  "VALUES (${sha256(state)},${sha256(binding)},${input.client},${sha256(nonce)},decode(${encrypt(verifier, config!.encryptionKey)},'base64'),",
  "VALUES (${sha256(state)},${sha256(binding)},${input.client},${sha256(nonce)},decode(${encrypt(nonce, config!.encryptionKey)},'base64'),decode(${encrypt(verifier, config!.encryptionKey)},'base64'),");
const consume = ln([
  '    const recordResult = await database.execute(sql`',
  '      WITH pending AS MATERIALIZED (',
  '        SELECT state_hash, nonce_ciphertext, pkce_verifier_ciphertext',
  '        FROM oidc_auth_transactions',
  '        WHERE state_hash=${sha256(parsed.data.state)} AND browser_binding_hash=${sha256(binding)}',
  '          AND client_kind=${kind} AND consumed_at IS NULL AND expires_at>now()',
  '        FOR UPDATE',
  '      )',
  '      UPDATE oidc_auth_transactions AS t',
  "      SET consumed_at=now(), nonce_ciphertext=decode('','hex'), pkce_verifier_ciphertext=decode('','hex')",
  '      FROM pending WHERE t.state_hash=pending.state_hash',
  "      RETURNING t.nonce_hash, encode(pending.nonce_ciphertext,'base64') AS encrypted_nonce,",
  "        encode(pending.pkce_verifier_ciphertext,'base64') AS encrypted_verifier,",
  '        t.return_to, t.claim_user_id, t.stepup_user_id, t.flow_kind',
  '    `);',
  '    const record = recordResult.rows[0];',
]);
between(route, '    const recordResult = await database.execute(sql`', '    expireBinding(reply, env);', consume);
change(route,
  "      const identity = await exchangeAndVerify(config, await discover(config), kind as Auth0ClientKind,\n        parsed.data.code, verifier, String(record.nonce_hash));",
  "      const nonce = decrypt(String(record.encrypted_nonce), config.encryptionKey);\n      if (sha256(nonce) !== String(record.nonce_hash)) throw new Error('OIDC_NONCE_MISMATCH');\n      const identity = await verifyAuth0Grant(config, kind as Auth0ClientKind, parsed.data.code, parsed.data.state, nonce, verifier);");

change(migration,
  "ALTER TABLE users ADD COLUMN IF NOT EXISTS closed_at timestamptz;",
  "ALTER TABLE oidc_auth_transactions ADD COLUMN IF NOT EXISTS nonce_ciphertext bytea;\n--> statement-breakpoint\nALTER TABLE users ADD COLUMN IF NOT EXISTS closed_at timestamptz;");
change(journal, '1789049762219', '1789049760000');

change(oidc,
  "import { createHash, createPublicKey, randomBytes, timingSafeEqual, verify } from 'node:crypto';",
  "import { createHash, randomBytes } from 'node:crypto';");
between(oidc, 'const same = (a: string, b: string): boolean => {', 'function httpsOrigin(', '');
between(oidc, 'function validateIdToken(', 'export async function requestPasswordReset(', '');
change(oidc,
  'export async function requestPasswordReset(config: Auth0Config, email: string): Promise<void> {',
  'export async function requestPasswordReset(config: Auth0Config, email: string, kind: Auth0ClientKind = \'shopper\'): Promise<void> {');
change(oidc,
  'client_id: config.clients.shopper.clientId, connection: config.databaseConnection, email',
  'client_id: config.clients[kind].clientId, connection: config.databaseConnection, email');
change(oidc,
  "  if (env.AUTH0_ENABLED !== 'true') return null;",
  "  if (!env.AUTH0_ENABLED || env.AUTH0_ENABLED === 'false') return null;\n  if (env.AUTH0_ENABLED !== 'true') fail();");

change(auth,
  "import type { Auth0ClientKind } from '../auth0-oidc.js';",
  "import { parseAuth0Config, type Auth0ClientKind } from '../auth0-oidc.js';\nimport { registerAuth0Routes } from '../auth0-routes.js';");
change(auth,
  "  app.decorateRequest('auth', null);",
  "  const auth0Config = parseAuth0Config(process.env);\n  oidcEnabled = Boolean(auth0Config);\n  pilotEnabled = env.AUTH_PILOT_LOGIN_ENABLED !== 'false';\n  if (auth0Config && (!db || !env.MCP_ALLOWED_ORIGINS.includes(auth0Config.webOrigin) ||\n    Object.values(auth0Config.clients).some((client) => new URL(client.redirectUri).origin !== env.MCP_PUBLIC_ORIGIN)))\n    throw new Error('Auth0 origins or PostgreSQL are not configured for this API');\n  app.decorateRequest('auth', null);");
change(auth,
  "      reply.header('Set-Cookie', `${oauthCookie(env)}=${raw}; ${cookieAttributes(env)}; Max-Age=${12 * 3600}`);",
  "      const prior = reply.getHeader('Set-Cookie');\n      reply.header('Set-Cookie', [\n        ...(Array.isArray(prior) ? prior : prior ? [String(prior)] : []),\n        `${oauthCookie(env)}=${raw}; ${cookieAttributes(env)}; Max-Age=${12 * 3600}`,\n      ]);");
change(auth,
  "  });\n}\n\ndeclare module 'fastify' { interface FastifyInstance { authApi: AuthApi } }",
  "  });\n  registerAuth0Routes(app, db, env, auth0Config);\n}\n\ndeclare module 'fastify' { interface FastifyInstance { authApi: AuthApi } }");

change(env,
  'if (result.success && Object.keys(result.data).length) {',
  'if (result.success) {');
change(env,
  "  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(24),",
  "  AUTH_PILOT_LOGIN_ENABLED: z.enum(['true', 'false']).default('true'),\n  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(24),");
change(env,
  "      env.DEPLOY_ENV !== 'local' &&\n      env.AUTH_PILOT_CREDENTIALS['pilot@shopai.local'] ===",
  "      env.DEPLOY_ENV !== 'local' &&\n      env.AUTH_PILOT_LOGIN_ENABLED === 'true' &&\n      env.AUTH_PILOT_CREDENTIALS['pilot@shopai.local'] ===");
change(app,
  "    routerOptions: { maxParamLength: 1024 },",
  "    routerOptions: { maxParamLength: 1024 },\n    // Callback URLs contain authorization codes: never log raw request URLs.\n    disableRequestLogging: true,");
change(app,
  "        'req.body.token',",
  "        'req.body.token',\n        'req.body.pilotToken',\n        'req.body.code',\n        'req.query.code',\n        'req.query.state',");
change(app,
  '    return { user: request.auth };',
  '    return { user: request.auth, csrfToken: app.authApi.csrfToken(request) };');
console.log('Exact-match Auth0 source patches applied');
