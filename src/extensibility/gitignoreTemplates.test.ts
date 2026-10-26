import { strict as assert } from 'node:assert';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { describe, it } from 'node:test';

import {
  appendGitignorePatterns,
  gitignorePattern,
  gitignoreTemplateById,
  writeGitignorePatterns,
} from './gitignoreTemplates';

describe('gitignore templates', () => {
  it('finds a built-in template by id', () => {
    const node = gitignoreTemplateById('node');
    assert.ok(node);
    assert.ok(node?.patterns.includes('node_modules/'));
    assert.equal(gitignoreTemplateById('missing'), undefined);
  });

  it('marks directories with a trailing slash', () => {
    assert.equal(gitignorePattern('src/generated', true), 'src/generated/');
    assert.equal(gitignorePattern('src/app.ts', false), 'src/app.ts');
  });
});

describe('appendGitignorePatterns', () => {
  it('appends patterns that are not already present', () => {
    const result = appendGitignorePatterns('node_modules/\n', ['node_modules/', 'dist/', 'dist/']);
    assert.deepEqual(result.added, ['dist/']);
    assert.equal(result.text, 'node_modules/\ndist/\n');
  });

  it('keeps CRLF files in CRLF', () => {
    const result = appendGitignorePatterns('keep\r\n', ['.DS_Store']);
    assert.equal(result.text, 'keep\r\n.DS_Store\r\n');
  });

  it('leaves the file unchanged when every pattern exists', () => {
    const result = appendGitignorePatterns('dist/\n', ['dist/']);
    assert.deepEqual(result.added, []);
    assert.equal(result.text, 'dist/\n');
  });
});

describe('writeGitignorePatterns', () => {
  it('creates .gitignore and skips a second identical write', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'git-checkout-gitignore-'));
    const added = await writeGitignorePatterns(root, ['*.log', '*.log']);
    assert.deepEqual(added, ['*.log']);
    assert.equal(await readFile(path.join(root, '.gitignore'), 'utf8'), '*.log\n');

    const again = await writeGitignorePatterns(root, ['*.log']);
    assert.deepEqual(again, []);
  });
});
