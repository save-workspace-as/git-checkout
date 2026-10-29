import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import type { CommitDiffLineDto } from '../history/commitDetailsProtocol';
import { buildHunkPatch, buildSelectionPatch, hunkCount } from './hunkPatch';

const lines: CommitDiffLineDto[] = [
  { kind: 'hunk', text: '@@ -1,3 +1,3 @@' },
  { kind: 'context', text: 'a', line: 1 },
  { kind: 'del', text: 'b', line: 2 },
  { kind: 'add', text: 'B', line: 2 },
  { kind: 'hunk', text: '@@ -9,2 +9,2 @@ fn' },
  { kind: 'del', text: 'x', line: 9 },
  { kind: 'add', text: 'X', line: 9, noEol: true },
];

describe('buildHunkPatch', () => {
  it('counts hunks', () => {
    assert.equal(hunkCount(lines), 2);
    assert.equal(hunkCount([]), 0);
  });

  it('builds a patch for just the chosen hunk', () => {
    assert.equal(
      buildHunkPatch('src/a.ts', lines, 0),
      ['diff --git a/src/a.ts b/src/a.ts', '--- a/src/a.ts', '+++ b/src/a.ts', '@@ -1,3 +1,3 @@', ' a', '-b', '+B', ''].join('\n'),
    );
    assert.equal(
      buildHunkPatch('src/a.ts', lines, 1),
      [
        'diff --git a/src/a.ts b/src/a.ts', '--- a/src/a.ts', '+++ b/src/a.ts',
        '@@ -9,2 +9,2 @@ fn', '-x', '+X', '\\ No newline at end of file', '',
      ].join('\n'),
    );
    assert.equal(buildHunkPatch('src/a.ts', lines, 2), null);
  });

  it('marks a hunk that creates or deletes the whole file', () => {
    const created = buildHunkPatch('n.txt', [{ kind: 'hunk', text: '@@ -0,0 +1,1 @@' }, { kind: 'add', text: 'x' }], 0);
    assert.match(created ?? '', /new file mode 100644\n--- \/dev\/null\n\+\+\+ b\/n\.txt/);
    const deleted = buildHunkPatch('d.txt', [{ kind: 'hunk', text: '@@ -1,1 +0,0 @@' }, { kind: 'del', text: 'x' }], 0);
    assert.match(deleted ?? '', /deleted file mode 100644\n--- a\/d\.txt\n\+\+\+ \/dev\/null/);
  });
});

describe('buildSelectionPatch', () => {
  const diff: CommitDiffLineDto[] = [
    { kind: 'hunk', text: '@@ -1,4 +1,4 @@ fn' },
    { kind: 'context', text: 'a', line: 1 },
    { kind: 'del', text: 'b', line: 2 },
    { kind: 'del', text: 'c', line: 3 },
    { kind: 'add', text: 'B', line: 2 },
    { kind: 'add', text: 'C', line: 3 },
    { kind: 'context', text: 'd', line: 4 },
  ];
  const head = ['diff --git a/f b/f', '--- a/f', '+++ b/f'];
  const patch = (selected: number[], op: 'stage' | 'unstage' | 'discard') =>
    buildSelectionPatch('f', diff, new Set(selected), op);

  it('keeps an unselected removal as context and drops an unselected addition when staging', () => {
    assert.equal(
      patch([2, 4], 'stage'),
      [...head, '@@ -1,4 +1,4 @@ fn', ' a', '-b', ' c', '+B', ' d', ''].join('\n'),
    );
  });

  it('drops an unselected removal and keeps an unselected addition as context when reversing', () => {
    for (const op of ['unstage', 'discard'] as const) {
      assert.equal(
        patch([2, 4], op),
        [...head, '@@ -1,4 +1,4 @@ fn', ' a', '-b', '+B', ' C', ' d', ''].join('\n'),
        op,
      );
      // Only the added line: the removed lines are not there to bring back.
      assert.equal(
        patch([4], op),
        [...head, '@@ -1,3 +1,4 @@ fn', ' a', '+B', ' C', ' d', ''].join('\n'),
        op,
      );
    }
  });

  it('is the whole hunk when every change line is selected', () => {
    assert.equal(patch([2, 3, 4, 5], 'stage'), buildHunkPatch('f', diff, 0));
    assert.equal(patch([2, 3, 4, 5], 'discard'), buildHunkPatch('f', diff, 0));
  });

  it('leaves out a hunk with nothing selected and moves the next one by the lines before it', () => {
    const two: CommitDiffLineDto[] = [
      { kind: 'hunk', text: '@@ -1,2 +1,3 @@' }, { kind: 'context', text: 'a' }, { kind: 'add', text: 'x' }, { kind: 'context', text: 'b' },
      { kind: 'hunk', text: '@@ -9,2 +10,3 @@' }, { kind: 'context', text: 'i' }, { kind: 'add', text: 'y' }, { kind: 'context', text: 'j' },
      { kind: 'hunk', text: '@@ -20,2 +22,3 @@' }, { kind: 'context', text: 'p' }, { kind: 'add', text: 'z' }, { kind: 'context', text: 'q' },
    ];
    const staged = buildSelectionPatch('f', two, new Set([2, 10]), 'stage')!;
    assert.deepEqual(staged.split('\n').filter((line) => line.startsWith('@@')), ['@@ -1,2 +1,3 @@', '@@ -20,2 +21,3 @@']);
    const unstaged = buildSelectionPatch('f', two, new Set([2, 10]), 'unstage')!;
    assert.deepEqual(unstaged.split('\n').filter((line) => line.startsWith('@@')), ['@@ -1,2 +1,3 @@', '@@ -21,2 +22,3 @@']);
    assert.equal(buildSelectionPatch('f', two, new Set(), 'stage'), null);
    assert.equal(buildSelectionPatch('f', two, new Set([1]), 'stage'), null, 'a context line is not a change');
  });

  it('keeps the missing-newline marker with the line it belongs to, and drops it with a dropped line', () => {
    const lines: CommitDiffLineDto[] = [
      { kind: 'hunk', text: '@@ -1,2 +1,2 @@' },
      { kind: 'del', text: 'x' },
      { kind: 'add', text: 'X', noEol: true },
    ];
    assert.match(buildSelectionPatch('f', lines, new Set([2]), 'stage') ?? '', /\+X\n\\ No newline at end of file\n$/);
    assert.doesNotMatch(buildSelectionPatch('f', lines, new Set([1]), 'stage') ?? '', /No newline/);
  });

  it('says a file is created or deleted only when the whole change is selected', () => {
    const created: CommitDiffLineDto[] = [{ kind: 'hunk', text: '@@ -0,0 +1,2 @@' }, { kind: 'add', text: 'x' }, { kind: 'add', text: 'y' }];
    assert.match(buildSelectionPatch('n', created, new Set([1, 2]), 'unstage') ?? '', /new file mode 100644\n--- \/dev\/null\n\+\+\+ b\/n/);
    const partial = buildSelectionPatch('n', created, new Set([1]), 'unstage') ?? '';
    assert.doesNotMatch(partial, /new file|dev\/null/);
    assert.match(partial, /@@ -1 \+1,2 @@/);
    const deleted: CommitDiffLineDto[] = [{ kind: 'hunk', text: '@@ -1,2 +0,0 @@' }, { kind: 'del', text: 'x' }, { kind: 'del', text: 'y' }];
    assert.match(buildSelectionPatch('d', deleted, new Set([1, 2]), 'stage') ?? '', /deleted file mode 100644\n--- a\/d\n\+\+\+ \/dev\/null/);
    assert.doesNotMatch(buildSelectionPatch('d', deleted, new Set([1]), 'stage') ?? '', /deleted file|dev\/null/);
  });
});
