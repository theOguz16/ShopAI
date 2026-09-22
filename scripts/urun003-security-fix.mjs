import { readFileSync, writeFileSync } from 'node:fs';

const routePath = 'apps/api/src/auth0-routes.ts';
let route = readFileSync(routePath, 'utf8');
const begin = route.indexOf('function safeReturnTo(value: string, origin: string): string | null {');
const marker = '  const target = new URL(value, origin);';
const end = route.indexOf(marker, begin);
if (begin < 0 || end < begin || route.indexOf(marker, end + marker.length) !== -1)
  throw new Error('Return-path validation source mismatch');
const header = `function safeReturnTo(value: string, origin: string): string | null {\n  if (\n    !value.startsWith('/') ||\n    value.startsWith('//') ||\n    value.includes(String.fromCharCode(92)) ||\n    [...value].some((character) => character.charCodeAt(0) < 32)\n  ) return null;\n`;
route = route.slice(0, begin) + header + route.slice(end);
for (const [before, after] of [
  ["encode(pending.pkce_verifier_ciphertext,'base64') AS encrypted_verifier", 'pending.pkce_verifier_ciphertext AS encrypted_verifier'],
  ["decode(${encrypt(verifier, config!.encryptionKey)},'base64')", '${encrypt(verifier, config!.encryptionKey)}'],
  ["pkce_verifier_ciphertext=decode('','hex')", "pkce_verifier_ciphertext=''"],
]) {
  if (route.split(before).length !== 2) throw new Error(`PKCE source mismatch: ${before.slice(0, 20)}`);
  route = route.replace(before, after);
}
writeFileSync(routePath, route);

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
let test = readFileSync(testPath, 'utf8');
const importOld = "import { createDatabase } from '@shopai/db';";
if (test.split(importOld).length !== 2) throw new Error('OIDC test database import mismatch');
test = test.replace(importOld, "import { createDatabase } from '../../packages/db/src/client.js';");
const mockStart = test.indexOf("vi.mock('openid-client', () => ({");
const mockEnd = test.indexOf('\n\ndescribe(', mockStart);
if (mockStart < 0 || mockEnd < mockStart) throw new Error('OIDC mock fixture mismatch');
const mock = `// Business integration fixture: simulate the *output* of an already verified\n// provider, not token signatures, discovery or nonce verification. Those require\n// separate cryptographic tests and an actual Auth0/HTTPS staging acceptance.\nvi.mock('../../apps/api/src/auth0-client-library.js', () => ({\n  verifyAuth0Grant: async (\n    _configuration: unknown,\n    _kind: unknown,\n    code: string,\n  ) => {\n    if (code === 'unverified') throw new Error('OIDC_EMAIL_UNVERIFIED');\n    if (code === 'wrong-audience') throw new Error('OIDC_WRONG_AUDIENCE');\n    return {\n      issuer,\n      subject: 'auth0|verified-fixture',\n      email,\n      emailVerified: true,\n      mfa: true,\n      authenticatedAt: new Date(),\n    };\n  },\n}));`;
test = test.slice(0, mockStart) + mock + test.slice(mockEnd);
writeFileSync(testPath, test);
console.log('Prepared PKCE text storage, CSRF-aware merchant requests and an explicitly post-provider business test fixture.');
