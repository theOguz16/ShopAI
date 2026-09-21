import { readdir } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const testsRoot = resolve(root, 'tests');

async function testFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const path = resolve(directory, entry.name);
      return entry.isDirectory() ? testFiles(path) : [path];
    }),
  );
  return files.flat().filter((path) => path.endsWith('.test.ts'));
}

const inventory = (await testFiles(testsRoot))
  .map((path) => relative(root, path).split(sep).join('/'))
  .sort();
const integration = inventory.filter((path) =>
  path.startsWith('tests/integration/'),
);
const unit = inventory.filter((path) => !path.startsWith('tests/integration/'));

if (integration.length === 0 || unit.length === 0) {
  throw new Error('Unit ve integration test envanterleri boş olamaz.');
}

const duplicate = unit.filter((path) => integration.includes(path));
if (duplicate.length > 0) {
  throw new Error(
    `Birden fazla suite'e eşlenen testler: ${duplicate.join(', ')}`,
  );
}

if (unit.length + integration.length !== inventory.length) {
  throw new Error(
    'Bazı test dosyaları unit/integration suite eşlemesi dışında kaldı.',
  );
}

console.log(
  `Test suite inventory OK: ${unit.length} unit, ${integration.length} integration.`,
);
