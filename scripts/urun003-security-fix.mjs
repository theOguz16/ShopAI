import { readFileSync, writeFileSync } from 'node:fs';

const routePath = 'apps/api/src/auth0-routes.ts';
const route = readFileSync(routePath, 'utf8');
const begin = route.indexOf('function safeReturnTo(value: string, origin: string): string | null {');
const marker = '  const target = new URL(value, origin);';
const end = route.indexOf(marker, begin);
if (begin < 0 || end < begin || route.indexOf(marker, end + marker.length) !== -1)
  throw new Error('safeReturnTo source no longer matches');
const header = `function safeReturnTo(value: string, origin: string): string | null {\n  if (\n    !value.startsWith('/') ||\n    value.startsWith('//') ||\n    value.includes(String.fromCharCode(92)) ||\n    [...value].some((character) => character.charCodeAt(0) < 32)\n  ) return null;\n`;
let fixedRoute = route.slice(0, begin) + header + route.slice(end);
const replacements = [
  ["encode(pending.pkce_verifier_ciphertext,'base64') AS encrypted_verifier", 'pending.pkce_verifier_ciphertext AS encrypted_verifier'],
  ["decode(${encrypt(verifier, config!.encryptionKey)},'base64')", '${encrypt(verifier, config!.encryptionKey)}'],
  ["pkce_verifier_ciphertext=decode('','hex')", "pkce_verifier_ciphertext=''"],
];
for (const [before, after] of replacements) {
  if (fixedRoute.split(before).length !== 2) throw new Error(`PKCE source mismatch: ${before.slice(0, 20)}`);
  fixedRoute = fixedRoute.replace(before, after);
}
const phases = [
  ["      try {\n        const verifier = decrypt(", "      let phase = 'decrypt_verifier';\n      try {\n        const verifier = decrypt("],
  ["        const nonce = decrypt(\n", "        phase = 'decrypt_nonce';\n        const nonce = decrypt(\n"],
  ["        const identity = await verifyAuth0Grant(\n", "        phase = 'verify_grant';\n        const identity = await verifyAuth0Grant(\n"],
  ["        const userId = await resolveAccount(\n", "        phase = 'resolve_account';\n        const userId = await resolveAccount(\n"],
  ["        await app.authApi.issueOidcSession(\n", "        phase = 'issue_session';\n        await app.authApi.issueOidcSession(\n"],
  ["      } catch {\n        return authError(reply);\n      }", "      } catch (error) {\n        if (env.DEPLOY_ENV === 'test') {\n          const reason = error instanceof Error && /^[A-Z_]{3,80}$/u.test(error.message) ? error.message : 'OTHER';\n          const pg = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' && /^[A-Z0-9]{5}$/u.test(error.code) ? error.code : '';\n          const name = error instanceof Error && ['Error', 'TypeError', 'SyntaxError', 'RangeError'].includes(error.name) ? error.name : 'OTHER';\n          const text = error instanceof Error ? error.message : '';\n          const hints = ['discovery', 'serverMetadata', 'authorizationCodeGrant', 'issuer', 'client', 'nonce', 'state', 'code', 'idToken', 'claims', 'undefined', 'not a function', 'Invalid URL', 'fetch', 'scope', 'token', 'email'].filter((item) => text.includes(item)).join(',');\n          console.warn('OIDC_TEST_FAILURE', phase, reason, pg, name, hints);\n        }\n        return authError(reply);\n      }"],
];
for (const [before, after] of phases) {
  if (fixedRoute.split(before).length !== 2) throw new Error(`Callback diagnostic anchor mismatch: ${before.slice(0, 22)}`);
  fixedRoute = fixedRoute.replace(before, after);
}
writeFileSync(routePath, fixedRoute);

for (const [path, relative] of [
  ['apps/web/app/dashboard/merchant-context.tsx', '../../lib/authenticated-fetch'],
  ['apps/web/app/dashboard/products/page.tsx', '../../../lib/authenticated-fetch'],
  ['apps/web/app/dashboard/connections/page.tsx', '../../../lib/authenticated-fetch'],
  ['apps/web/app/dashboard/imports/page.tsx', '../../../lib/authenticated-fetch'],
]) {
  let content = readFileSync(path, 'utf8');
  if (!content.startsWith("'use client';\n") || !content.includes('await fetch(') || content.includes('authenticatedFetch'))
    throw new Error(`Unexpected client source ${path}`);
  content = content.replace("'use client';\n", `'use client';\n\nimport { authenticatedFetch } from '${relative}';\n`)
    .replaceAll('await fetch(', 'await authenticatedFetch(');
  writeFileSync(path, content);
}

const authPath = 'apps/api/src/plugins/auth.ts';
let auth = readFileSync(authPath, 'utf8');
const a = auth.indexOf('  const clearCookies = (reply: FastifyReply) => {');
const b = auth.indexOf('  const authApi: AuthApi = {', a);
if (a < 0 || b < 0) throw new Error('Pilot cookie cleanup source mismatch');
const clear = `  const clearCookies = (reply: FastifyReply, oidcSession: boolean) => {\n    const secure = env.DEPLOY_ENV === 'staging' || env.DEPLOY_ENV === 'production';\n    const pilotExpiry = \`\${legacyCookie}=; HttpOnly; SameSite=Lax\${secure ? '; Secure' : ''}; Max-Age=0; Path=/\`;\n    const oauthExpiry = \`\${oauthCookie(env)}=; \${cookieAttributes(env)}; Max-Age=0\`;\n    reply.header('Set-Cookie', oidcSession ? [pilotExpiry, oauthExpiry] : pilotExpiry);\n  };\n`;
auth = auth.slice(0, a) + clear + auth.slice(b);
const call = '      clearCookies(reply);';
if (auth.split(call).length !== 3) throw new Error('Unexpected logout cookie call count');
auth = auth.replaceAll(call, '      clearCookies(reply, Boolean(cookie(request, oauthCookie(env))));');
writeFileSync(authPath, auth);

const testPath = 'tests/integration/auth0-flows.test.ts';
const test = readFileSync(testPath, 'utf8');
const importOld = "import { createDatabase } from '@shopai/db';";
if (test.split(importOld).length !== 2) throw new Error('OIDC test import mismatch');
writeFileSync(testPath, test.replace(importOld, "import { createDatabase } from '../../packages/db/src/client.js';"));
console.log('Patched PKCE; mock-library stages diagnose the grant without exposing credentials.');
