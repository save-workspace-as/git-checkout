import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';
import { describe, it } from 'node:test';

const root = join(__dirname, '..');
const IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])([^'"]+)\1/g;

function sourceFiles(dir: string): string[] {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(path);
    }
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

/** Every module a file imports: relative ones as repo paths, packages by name. */
function importsOf(file: string): { relative: string[]; packages: string[] } {
  const found = { relative: [] as string[], packages: [] as string[] };
  for (const match of readFileSync(join(root, file), 'utf8').matchAll(IMPORT)) {
    const spec = match[2];
    if (spec.startsWith('.')) {
      found.relative.push(normalize(relative(root, join(root, dirname(file), spec))));
    } else {
      found.packages.push(spec);
    }
  }
  return found;
}

function violations(files: string[], allowed: (file: string, target: string) => boolean): string[] {
  return files.flatMap((file) =>
    importsOf(file).relative.filter((target) => !allowed(file, target)).map((target) => `${file} -> ${target}`),
  );
}

describe('source layout', () => {
  it('keeps src/shared free of anything but shared code and the VS Code-free runtime', () => {
    const files = sourceFiles('src/shared');
    assert.deepEqual(violations(files, (_file, target) => target.startsWith(`src${'/'}shared`)), []);
    const usesVscode = files.filter((file) => importsOf(file).packages.includes('vscode'));
    assert.deepEqual(usesVscode, [], 'shared code is also bundled for the webviews, so it cannot import vscode');
  });

  it('lets the webviews import only their own code and src/shared', () => {
    const files = sourceFiles('webview');
    assert.deepEqual(
      violations(files, (_file, target) => target.startsWith('webview/') || target.startsWith('src/shared/')),
      [],
    );
  });

  it('keeps src/core independent of features, panel, UI and extensibility code', () => {
    const files = sourceFiles('src/core').filter((file) => !file.startsWith(join('src', 'core', 'testing')));
    assert.deepEqual(
      violations(files, (_file, target) =>
        !/^src\/(features|panel|ui|extensibility)(\/|$)/.test(target.replace(/\\/g, '/'))),
      [],
    );
  });
});
