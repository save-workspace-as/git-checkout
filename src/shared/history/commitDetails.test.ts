import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  commitDetailsDiffArgs,
  commitFileDiffEndpoints,
  EMPTY_TREE_REVISION,
  parseCommitNameStatus,
} from './commitDetails';

describe('parseCommitNameStatus', () => {
  it('reads NUL-separated status records and keeps spaces in paths', () => {
    assert.deepEqual(parseCommitNameStatus('M\0my file.txt\0A\0dir/new.txt\0D\0gone.txt\0'), [
      { status: 'M', path: 'my file.txt' },
      { status: 'A', path: 'dir/new.txt' },
      { status: 'D', path: 'gone.txt' },
    ]);
  });

  it('pairs rename and copy records', () => {
    assert.deepEqual(parseCommitNameStatus('R100\0old name.txt\0new name.txt\0C075\0src/a.ts\0src/b.ts\0'), [
      { status: 'R100', path: 'new name.txt', oldPath: 'old name.txt' },
      { status: 'C075', path: 'src/b.ts', oldPath: 'src/a.ts' },
    ]);
  });

  it('returns nothing for empty output and skips a status with no path', () => {
    assert.deepEqual(parseCommitNameStatus(''), []);
    assert.deepEqual(parseCommitNameStatus('\0'), []);
    assert.deepEqual(parseCommitNameStatus('M\0'), []);
  });
});

describe('commitFileDiffEndpoints', () => {
  it('diffs a modification against the first parent', () => {
    assert.deepEqual(
      commitFileDiffEndpoints('abc', 'def', { status: 'M', path: 'a.txt' }),
      {
        leftRevision: 'def',
        leftPath: 'a.txt',
        rightRevision: 'abc',
        rightPath: 'a.txt',
      },
    );
  });

  it('uses the previous path for renames and the empty tree when there is no parent', () => {
    assert.deepEqual(
      commitFileDiffEndpoints('abc', null, { status: 'R100', path: 'b.txt', oldPath: 'a.txt' }),
      {
        leftRevision: EMPTY_TREE_REVISION,
        leftPath: 'a.txt',
        rightRevision: 'abc',
        rightPath: 'b.txt',
      },
    );
  });
});

describe('commitDetailsDiffArgs', () => {
  it('asks diff-tree for a first-parent name-status listing', () => {
    assert.deepEqual(commitDetailsDiffArgs('HEAD'), [
      'diff-tree',
      '--no-commit-id',
      '--root',
      '-r',
      '-m',
      '--first-parent',
      '-z',
      '--name-status',
      '--find-renames',
      'HEAD',
    ]);
  });
});
