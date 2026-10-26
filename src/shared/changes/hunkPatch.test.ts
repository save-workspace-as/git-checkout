import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import type { CommitDiffLineDto } from '../history/commitDetailsProtocol';
import { buildHunkPatch, hunkCount } from './hunkPatch';

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
