import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { parseFileHunks, previousLines, type DiffHunk } from './blameStepBack';

const h = (oldStart: number, oldCount: number, newStart: number, newCount: number): DiffHunk => ({ oldStart, oldCount, newStart, newCount });

describe('parseFileHunks', () => {
  const diff = [
    'diff --git a/other.txt b/other.txt', '--- a/other.txt', '+++ b/other.txt', '@@ -1 +1 @@', '-x', '+y',
    'diff --git a/old/name.ts b/new/name.ts', 'similarity index 90%', 'rename from old/name.ts', 'rename to new/name.ts',
    '--- a/old/name.ts', '+++ b/new/name.ts', '@@ -3,2 +3,3 @@ context', '-a', '-b', '+c', '+d', '+e', '@@ -10 +11,0 @@', '-gone',
    'diff --git a/added.txt b/added.txt', 'new file mode 100644', '--- /dev/null', '+++ b/added.txt', '@@ -0,0 +1,2 @@', '+one', '+two',
  ].join('\n');

  it('finds the hunks of the file and the name it had before', () => {
    assert.deepEqual(parseFileHunks(diff, 'new/name.ts'), { oldPath: 'old/name.ts', newPath: 'new/name.ts', hunks: [h(3, 2, 3, 3), h(10, 1, 11, 0)] });
    assert.deepEqual(parseFileHunks(diff, 'other.txt')?.hunks, [h(1, 1, 1, 1)]);
  });

  it('gives nothing for a file the diff does not touch, or one it added', () => {
    assert.equal(parseFileHunks(diff, 'missing.txt'), undefined);
    assert.equal(parseFileHunks(diff, 'added.txt'), undefined);
    assert.equal(parseFileHunks('', 'a.txt'), undefined);
  });
});

describe('previousLines', () => {
  const hunks = [h(3, 2, 3, 3), h(10, 1, 11, 0), h(20, 0, 20, 2)];

  it('gives the lines a changed line replaced', () => {
    assert.deepEqual(previousLines(hunks, 3), { first: 3, last: 4 });
    assert.deepEqual(previousLines(hunks, 5), { first: 3, last: 4 });
  });

  it('gives nothing for a line that was only added', () => {
    assert.equal(previousLines(hunks, 20), undefined);
    assert.equal(previousLines(hunks, 21), undefined);
  });

  it('moves a line by the changes above it', () => {
    assert.deepEqual(previousLines(hunks, 1), { first: 1, last: 1 });
    assert.deepEqual(previousLines(hunks, 6), { first: 5, last: 5 }, 'one line was added above');
    assert.deepEqual(previousLines(hunks, 12), { first: 12, last: 12 }, 'a line was added at 3-5 and one removed at 10');
    assert.deepEqual(previousLines(hunks, 25), { first: 23, last: 23 }, 'and two were added at 20');
  });

  it('copes with no hunks and with a line before the start', () => {
    assert.deepEqual(previousLines([], 7), { first: 7, last: 7 });
    assert.equal(previousLines([h(1, 0, 1, 3)], 2), undefined);
  });
});
