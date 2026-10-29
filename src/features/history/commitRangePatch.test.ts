import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  buildBranchCommitRange,
  buildRangeFromOrderedShas,
  detectPatchApplyKind,
  gitArgsForPatchApply,
  rangeForRevision,
  gitArgsForPatchExport,
  mapPatchApplyError,
} from './commitRangePatch';

describe('commitRangePatch', () => {
  it('builds a single-commit range', () => {
    assert.equal(buildRangeFromOrderedShas(['abc1234']), 'abc1234^..abc1234');
  });

  it('builds a multi-commit range', () => {
    assert.equal(buildRangeFromOrderedShas(['aaa', 'bbb', 'ccc']), 'aaa^..ccc');
  });

  it('builds branch compare range', () => {
    assert.equal(buildBranchCommitRange('main', 'feature'), 'main..feature');
  });

  it('maps git export args', () => {
    assert.deepEqual(gitArgsForPatchExport('main..feature', 'format-patch'), [
      'format-patch',
      '--stdout',
      'main..feature',
    ]);
    assert.deepEqual(gitArgsForPatchExport('a^..b', 'diff'), ['diff', 'a^..b']);
  });

  it('detects mbox vs unified patches', () => {
    assert.equal(
      detectPatchApplyKind('From 1234567890abcdef1234567890abcdef12345678 Mon Sep 17 00:00:00 2001'),
      'mbox',
    );
    assert.equal(detectPatchApplyKind('diff --git a/foo b/foo\n--- a/foo\n+++ b/foo'), 'unified');
  });

  it('applies a Git patch as a commit only when asked to', () => {
    assert.deepEqual(gitArgsForPatchApply('mbox'), ['am', '--3way']);
    assert.deepEqual(gitArgsForPatchApply('mbox', false), ['apply', '--3way']);
    assert.deepEqual(gitArgsForPatchApply('unified', true), ['apply', '--3way']);
  });

  it('turns a revision into the commits to save', () => {
    assert.equal(rangeForRevision('abc1234'), 'abc1234^..abc1234');
    assert.equal(rangeForRevision(' main '), 'main^..main');
    assert.equal(rangeForRevision('main..topic'), 'main..topic');
    assert.throws(() => rangeForRevision('  '), /revision/i);
  });

  it('maps apply errors to user-facing text', () => {
    assert.match(
      mapPatchApplyError('error: patch does not apply\n', 1),
      /does not apply cleanly/i,
    );
    assert.match(mapPatchApplyError('error: corrupt patch at line 3', 128), /valid git patch/i);
  });
});
