import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { filterTestFiles, listNodeTestFiles, splitTestArgs } from './nodeTestFiles';

describe('listNodeTestFiles', () => {
  it('lists unit and integration tests separately', () => {
    const root = mkdtempSync(join(tmpdir(), 'node-test-files-'));
    try {
      mkdirSync(join(root, 'nested'));
      writeFileSync(join(root, 'a.test.ts'), '');
      writeFileSync(join(root, 'note.ts'), '');
      writeFileSync(join(root, 'nested', 'b.integration.test.ts'), '');
      writeFileSync(join(root, 'nested', 'c.test.ts'), '');

      assert.deepEqual(listNodeTestFiles(root, 'unit'), [
        join(root, 'a.test.ts'),
        join(root, 'nested', 'c.test.ts'),
      ]);
      assert.deepEqual(listNodeTestFiles(root, 'integration'), [
        join(root, 'nested', 'b.integration.test.ts'),
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('splitTestArgs', () => {
  const valueFlags = new Set(['--grep']);

  it('separates file filters from runner flags and keeps flag values', () => {
    assert.deepEqual(splitTestArgs(['worktree', '--grep', 'Exit', 'reflog', '--bail'], valueFlags), {
      filters: ['worktree', 'reflog'],
      flags: ['--grep', 'Exit', '--bail'],
    });
  });

  it('treats an inline value as part of its flag', () => {
    assert.deepEqual(splitTestArgs(['--grep=Exit', 'reflog'], valueFlags), {
      filters: ['reflog'],
      flags: ['--grep=Exit'],
    });
  });

  it('returns nothing for no arguments', () => {
    assert.deepEqual(splitTestArgs([], valueFlags), { filters: [], flags: [] });
  });
});

describe('filterTestFiles', () => {
  const files = ['src/git/a.test.ts', 'src/ui/b.test.ts', 'src/ui/c.test.ts'];

  it('keeps every file without filters', () => {
    assert.deepEqual(filterTestFiles(files, []), files);
  });

  it('matches any filter by substring of the path', () => {
    assert.deepEqual(filterTestFiles(files, ['ui/']), ['src/ui/b.test.ts', 'src/ui/c.test.ts']);
    assert.deepEqual(filterTestFiles(files, ['a.test', 'c.test']), ['src/git/a.test.ts', 'src/ui/c.test.ts']);
    assert.deepEqual(filterTestFiles(files, ['nope']), []);
  });
});
