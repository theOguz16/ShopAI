import { readFileSync, writeFileSync } from 'node:fs';

const routePath = 'apps/api/src/auth0-routes.ts';
const route = readFileSync(routePath, 'utf8');
const begin = route.indexOf('function safeReturnTo(value: string, origin: string): string | null {');
const marker = '  const target = new URL(value, origin);';
const end = route.indexOf(marker, begin);
if (begin < 0 || end < begin || route.indexOf(marker, end + marker.length) !== -1)
  throw new Error('safeReturnTo source no longer matches');
const header = `function safeReturnTo(value: string, origin: string): string | null {\n  if (\n    !value.startsWith('/') ||\n    value.startsWith('//') ||\n    value.includes(String.fromCharCode(92)) ||\n    [...value].some((character) => character.charCodeAt(0) < 32)\n  ) return null;\n`;
writeFileSync(routePath, route.slice(0, begin) + header + route.slice(end));

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
console.log('Auth0 redirect local-path validation and CSRF-aware merchant fetch patched; integration required.');
