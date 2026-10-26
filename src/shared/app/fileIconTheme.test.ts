import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { decodeFontCharacter, iconThemeKind, resolveIconId, type IconThemeDocument } from './fileIconTheme';

const theme: IconThemeDocument = {
  file: 'file',
  folder: 'folder',
  folderExpanded: 'folder-open',
  fileNames: { 'package.json': 'npm', dockerfile: 'docker' },
  fileExtensions: { ts: 'typescript', 'test.ts': 'test', gitignore: 'git' },
  folderNames: { src: 'src-folder' },
  folderNamesExpanded: { src: 'src-folder-open' },
  languageIds: { swift: 'swift-lang' },
  light: { file: 'file-light', fileExtensions: { ts: 'typescript-light' } },
};

const file = (name: string, languageId?: string) => ({ name, directory: false, languageId });

describe('resolveIconId', () => {
  it('prefers an exact file name, then the longest extension, then the language, then the default', () => {
    assert.equal(resolveIconId(theme, file('package.json'), 'dark'), 'npm');
    assert.equal(resolveIconId(theme, file('Dockerfile'), 'dark'), 'docker');
    assert.equal(resolveIconId(theme, file('a.test.ts'), 'dark'), 'test');
    assert.equal(resolveIconId(theme, file('a.ts'), 'dark'), 'typescript');
    assert.equal(resolveIconId(theme, file('.gitignore'), 'dark'), 'git');
    assert.equal(resolveIconId(theme, file('Runner.swift', 'swift'), 'dark'), 'swift-lang');
    assert.equal(resolveIconId(theme, file('notes'), 'dark'), 'file');
  });

  it('picks folder icons by name and open state', () => {
    assert.equal(resolveIconId(theme, { name: 'src', directory: true }, 'dark'), 'src-folder');
    assert.equal(resolveIconId(theme, { name: 'SRC', directory: true, expanded: true }, 'dark'), 'src-folder-open');
    assert.equal(resolveIconId(theme, { name: 'lib', directory: true, expanded: true }, 'dark'), 'folder-open');
    assert.equal(resolveIconId(theme, { name: 'lib', directory: true }, 'dark'), 'folder');
  });

  it('applies the light overrides over the base theme', () => {
    assert.equal(resolveIconId(theme, file('a.ts'), 'light'), 'typescript-light');
    assert.equal(resolveIconId(theme, file('notes'), 'light'), 'file-light');
    assert.equal(resolveIconId(theme, file('package.json'), 'light'), 'npm');
  });

  it('maps VS Code color theme kinds', () => {
    assert.deepEqual([1, 2, 3, 4].map((kind) => iconThemeKind(kind as 1 | 2 | 3 | 4)), [
      'light', 'dark', 'highContrast', 'highContrast',
    ]);
  });
});

describe('decodeFontCharacter', () => {
  it('turns an escaped code point into its glyph and keeps literal characters', () => {
    assert.equal(decodeFontCharacter('\\E023'), '\uE023');
    assert.equal(decodeFontCharacter('\\1F600'), '😀');
    assert.equal(decodeFontCharacter('\uE023'), '\uE023');
  });
});
