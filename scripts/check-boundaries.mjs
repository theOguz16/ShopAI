import { readdir, readFile } from 'node:fs/promises';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import ts from 'typescript';

const root = process.cwd();
const errors = [];
const browserPackages = new Set(['web', 'chatgpt-widget', 'ui']);
const serverOnlyPackages = new Set([
  '@shopai/db',
  '@shopai/commerce',
  '@shopai/ai',
  '@shopai/connectors',
]);
const sourceExtensions = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
]);

async function sourceFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (
      entry.name === 'dist' ||
      entry.name === 'node_modules' ||
      entry.name === '.next'
    )
      continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(path)));
    else if (sourceExtensions.has(extname(entry.name))) files.push(path);
  }
  return files;
}

function importsIn(source, file) {
  const parsed = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const imports = [];
  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      imports.push(node.moduleSpecifier.text);
    if (
      ts.isCallExpression(node) &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0]) &&
      ((ts.isIdentifier(node.expression) &&
        node.expression.text === 'require') ||
        node.expression.kind === ts.SyntaxKind.ImportKeyword)
    )
      imports.push(node.arguments[0].text);
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  return imports;
}

function forbiddenBrowserImport(specifier, importer) {
  if (
    [...serverOnlyPackages].some(
      (name) => specifier === name || specifier.startsWith(`${name}/`),
    )
  )
    return specifier;
  if (!specifier.startsWith('.')) return undefined;
  const target = resolve(dirname(importer), specifier);
  for (const name of ['db', 'commerce', 'ai', 'connectors']) {
    const packageRoot = resolve(root, 'packages', name);
    if (target === packageRoot || target.startsWith(`${packageRoot}${sep}`))
      return relative(root, target);
  }
  return undefined;
}

for (const group of ['apps', 'packages']) {
  for (const entry of await readdir(resolve(root, group), {
    withFileTypes: true,
  })) {
    if (!entry.isDirectory()) continue;
    const dir = entry.name;
    const packageRoot = resolve(root, group, dir);
    const manifestFile = resolve(packageRoot, 'package.json');
    const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
    const dependencies = Object.keys(manifest.dependencies ?? {});
    if (browserPackages.has(dir)) {
      for (const dependency of dependencies)
        if (serverOnlyPackages.has(dependency))
          errors.push(
            `${relative(root, manifestFile)}: browser cannot depend on ${dependency}`,
          );
      for (const file of await sourceFiles(packageRoot)) {
        for (const specifier of importsIn(await readFile(file, 'utf8'), file)) {
          const forbidden = forbiddenBrowserImport(specifier, file);
          if (forbidden)
            errors.push(
              `${relative(root, file)}: browser cannot import ${forbidden}`,
            );
        }
      }
    }
    if (dir === 'commerce')
      for (const dependency of dependencies)
        if (dependency !== '@shopai/contracts')
          errors.push(
            `${relative(root, manifestFile)}: domain dependency ${dependency}`,
          );
  }
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else console.info('Workspace dependency and source boundaries OK');
