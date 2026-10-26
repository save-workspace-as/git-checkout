import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  commitTreePathContext,
  defaultPathHistoryFollow,
  hunkHistoryContext,
  isCommitTreePathContext,
  isHunkHistoryContext,
  locateRepoFile,
  parentRepoPath,
  parseHunkHeaderRange,
  parseHunkLineRange,
  pathHistorySummary,
  pathHistoryTitle,
  resetFileConfirmMessage,
} from './pathHistoryProtocol';

describe('path history labels', () => {
  it('follows renames for files only and describes the active options', () => {
    assert.equal(defaultPathHistoryFollow('file'), true);
    assert.equal(defaultPathHistoryFollow('directory'), false);
    assert.equal(defaultPathHistoryFollow('hunk'), false);
    assert.equal(pathHistoryTitle('directory', 'src'), 'Folder History: src');
    assert.equal(
      pathHistorySummary({ scope: 'file', follow: true, includeMerges: false }),
      'Following renames · Hiding merge commits',
    );
    assert.equal(
      pathHistorySummary({
        scope: 'hunk',
        follow: false,
        includeMerges: true,
        startLine: 2,
        endLine: 5,
      }),
      'Lines 2-5 · Including merge commits',
    );
  });

  it('names the file and a short revision in the reset confirmation', () => {
    assert.equal(
      resetFileConfirmMessage('src/app.ts', 'abcdef123456'),
      'Reset src/app.ts to abcdef1? This replaces the index and working tree copy of this file.',
    );
  });
});

describe('hunk line ranges', () => {
  it('parses input ranges and hunk headers', () => {
    assert.deepEqual(parseHunkLineRange('12,40'), { start: 12, end: 40 });
    assert.deepEqual(parseHunkLineRange('40-12'), { start: 12, end: 40 });
    assert.deepEqual(parseHunkLineRange('8'), { start: 8, end: 8 });
    assert.equal(parseHunkLineRange('0,4'), null);
    assert.equal(parseHunkLineRange('a,b'), null);
    assert.deepEqual(parseHunkHeaderRange('@@ -10,3 +12,5 @@ fn'), { start: 12, end: 16 });
    assert.deepEqual(parseHunkHeaderRange('@@ -1 +4 @@'), { start: 4, end: 4 });
    assert.deepEqual(parseHunkHeaderRange('@@ -2,2 +8,0 @@'), { start: 8, end: 8 });
    assert.equal(parseHunkHeaderRange('not a hunk'), null);
  });

  it('builds native context menus for the file tree and a hunk', () => {
    const tree = commitTreePathContext('src', 'tree');
    const blob = commitTreePathContext('src/app.ts', 'blob');
    assert.equal(commitTreePathContext('src/app.ts', 'blob', 'abc123').revision, 'abc123');
    assert.equal(isCommitTreePathContext(tree), true);
    assert.equal(isCommitTreePathContext(blob), true);
    assert.equal(isCommitTreePathContext({ webviewSection: 'commit' }), false);
    const hunk = hunkHistoryContext('src/app.ts', '@@ -1,2 +3,4 @@');
    assert.deepEqual(hunk, {
      webviewSection: 'hunk',
      path: 'src/app.ts',
      startLine: 3,
      endLine: 6,
      preventDefaultContextMenuItems: true,
    });
    assert.equal(hunkHistoryContext('src/app.ts', 'nope'), null);
    assert.equal(isHunkHistoryContext(hunk), true);
  });
});

describe('locateRepoFile', () => {
  it('picks the longest containing root and the parent of a file', () => {
    const roots = ['/work/repo', '/work/repo/nested'];
    assert.deepEqual(locateRepoFile(roots, '/work/repo/nested/src/app.ts'), {
      repoRoot: '/work/repo/nested',
      path: 'src/app.ts',
    });
    assert.deepEqual(locateRepoFile(roots, '/work/repo'), { repoRoot: '/work/repo', path: '.' });
    assert.equal(locateRepoFile(roots, '/elsewhere/app.ts'), undefined);
    assert.equal(parentRepoPath('src/app.ts'), 'src');
    assert.equal(parentRepoPath('app.ts'), '.');
  });
});
