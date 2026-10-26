import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { blameEndLine, buildBlameArgs, buildBlameRangesArgs, lineRanges } from './blameQuery';

describe('blame git arguments', () => {
  it('blames a line window, including a revision before the path', () => {
    assert.deepEqual(buildBlameArgs('', 'dir\\notes.txt', 1, 2000), [
      'blame',
      '--porcelain',
      '-L1,2000',
      '--',
      'dir/notes.txt',
    ]);
    assert.deepEqual(buildBlameArgs('abc123', 'notes.txt', 5, 8), [
      'blame',
      '--porcelain',
      '-L5,8',
      'abc123',
      '--',
      'notes.txt',
    ]);
  });

  it('reads the end-of-file fatal', () => {
    assert.equal(blameEndLine('fatal: file notes.txt has only 12 lines\n'), 12);
    assert.equal(blameEndLine('fatal: bad revision'), undefined);
  });

  it('groups line numbers into ranges and blames them in one call', () => {
    assert.deepEqual(lineRanges([7, 3, 4, 5, 9, 4, 0, 10]), [[3, 5], [7, 7], [9, 10]]);
    assert.deepEqual(lineRanges([]), []);
    assert.deepEqual(buildBlameRangesArgs('abc', 'dir\\a.ts', [[3, 5], [9, 10]]), [
      'blame', '--porcelain', '-L3,5', '-L9,10', 'abc', '--', 'dir/a.ts',
    ]);
  });
});

