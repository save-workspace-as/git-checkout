import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  commitDiffGitArgs,
  DEFAULT_COMMIT_DIFF_VIEW,
  parseStoredDiffView,
  presentDiffLines,
  stepContextLines,
  type CommitDiffViewOptions,
} from './commitDiffPresentation';
import type { CommitDiffLineDto } from '../history/commitDetailsProtocol';

const lines: CommitDiffLineDto[] = [
  { kind: 'hunk', text: '@@ -1,4 +1,4 @@' },
  { kind: 'context', text: 'a', line: 1 },
  { kind: 'context', text: 'b', line: 2 },
  { kind: 'del', text: '  old', line: 3 },
  { kind: 'add', text: 'old', line: 3 },
  { kind: 'del', text: 'x', line: 4 },
  { kind: 'add', text: 'y', line: 4 },
];

const shown: CommitDiffViewOptions = DEFAULT_COMMIT_DIFF_VIEW;

describe('presentDiffLines', () => {
  it('keeps every line inline when no options are on', () => {
    const rows = presentDiffLines(lines, shown);
    assert.deepEqual(
      rows.map((row) => row.type),
      ['hunk', 'inline', 'inline', 'inline', 'inline', 'inline', 'inline'],
    );
  });

  it('pairs deletions with additions side by side and can swap them', () => {
    const rows = presentDiffLines(lines, { ...shown, sideBySide: true });
    assert.deepEqual(
      rows.filter((row) => row.type === 'pair'),
      [
        { type: 'pair', left: 1, right: 1 },
        { type: 'pair', left: 2, right: 2 },
        { type: 'pair', left: 3, right: 4 },
        { type: 'pair', left: 5, right: 6 },
      ],
    );
    const swapped = presentDiffLines(lines, { ...shown, sideBySide: true, swapped: true });
    assert.deepEqual(swapped.find((row) => row.type === 'pair' && row.left === 4), {
      type: 'pair',
      left: 4,
      right: 3,
    });
  });
});

describe('context size', () => {
  it('steps through the levels and stops at either end', () => {
    assert.equal(stepContextLines(3, 1), 6);
    assert.equal(stepContextLines(3, -1), 1);
    assert.equal(stepContextLines(0, -1), 0);
    assert.equal(stepContextLines(96, 1), 96);
    assert.equal(stepContextLines(5, 1), 6);
    assert.equal(stepContextLines(5, -1), 3);
  });

  it('maps the view to git arguments', () => {
    assert.deepEqual(commitDiffGitArgs(shown), ['-U3']);
    assert.deepEqual(commitDiffGitArgs({ ...shown, ignoreWhitespace: true, contextLines: 12 }), ['-U12', '-w']);
    assert.deepEqual(commitDiffGitArgs({ ...shown, fullFile: true }), ['-U1000000']);
  });
});

describe('parseStoredDiffView', () => {
  it('restores valid saved options and falls back to defaults for the rest', () => {
    assert.deepEqual(parseStoredDiffView(undefined), DEFAULT_COMMIT_DIFF_VIEW);
    assert.deepEqual(parseStoredDiffView('junk'), DEFAULT_COMMIT_DIFF_VIEW);
    assert.deepEqual(
      parseStoredDiffView({ ignoreWhitespace: true, contextLines: 12, wrapLines: 'yes', sideBySide: true, swapped: true }),
      { ...DEFAULT_COMMIT_DIFF_VIEW, ignoreWhitespace: true, contextLines: 12, sideBySide: true, swapped: true },
    );
    assert.equal(parseStoredDiffView({ contextLines: -1 }).contextLines, 3);
    assert.equal(parseStoredDiffView({ swapped: true }).swapped, false);
  });
});
