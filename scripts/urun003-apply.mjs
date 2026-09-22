import { readFileSync, writeFileSync } from 'node:fs';

function change(path, oldText, newText) {
  const source = readFileSync(path, 'utf8');
  if (!source.includes(oldText) || source.indexOf(oldText) !== source.lastIndexOf(oldText))
    throw new Error(`Unexpected patch context: ${path}`);
  writeFileSync(path, source.replace(oldText, newText));
}
const env = 'apps/api/src/env.ts';
const route = 'apps/api/src/auth0-routes.ts';
change(env,
  'if (result.success && Object.keys(result.data).length) {',
  'if (result.success) {');
change(env,
  "  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(24),",
  "  AUTH_PILOT_LOGIN_ENABLED: z.enum(['true', 'false']).default('true'),\n  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(24),");
change(env,
  "      env.DEPLOY_ENV !== 'local' &&\n      env.AUTH_PILOT_CREDENTIALS['pilot@shopai.local'] ===",
  "      env.DEPLOY_ENV !== 'local' &&\n      env.AUTH_PILOT_LOGIN_ENABLED === 'true' &&\n      env.AUTH_PILOT_CREDENTIALS['pilot@shopai.local'] ===");
change(route,
  "    return reply.redirect(authorizationUrl(config!, authorizationEndpoint, input.client, {\n      state, nonce, verifier, signup: input.signup === 'true', stepup: flowKind === 'stepup',\n    }), 303);",
  "    const authorization = authorizationUrl(config!, authorizationEndpoint, input.client, {\n      state, nonce, verifier, signup: input.signup === 'true', stepup: flowKind === 'stepup',\n    });\n    // POST claim is called via fetch; a cross-site redirect from fetch does not\n    // navigate the browser. Return the URL after binding the browser cookie.\n    if (claimUserId) return reply.send({ authorizationUrl: authorization });\n    return reply.redirect(authorization, 303);");
console.log('Prepared Auth0 configuration and proof-bound redirect');
