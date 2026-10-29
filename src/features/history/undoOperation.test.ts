import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { describeReflogMessage, lastUndoableOperation, parseReflog } from './undoOperation';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const C = 'c'.repeat(40);

describe('undo last operation', () => {
  it('reads reflog lines and skips anything else', () => {
    assert.deepEqual(parseReflog(`${A}\0commit (amend): fix\n\nnot a line\n${B}\0reset: moving to HEAD~1\n`), [
      { sha: A, message: 'commit (amend): fix' },
      { sha: B, message: 'reset: moving to HEAD~1' },
    ]);
    assert.deepEqual(parseReflog(''), []);
  });

  it('names what moved the branch', () => {
    const cases: [string, string][] = [
      ['commit (amend): fix typo', 'Amend'],
      ['commit: add search', 'Commit'],
      ['commit (initial): first', 'Commit'],
      ['commit (merge): Merge branch x', 'Merge'],
      ['merge topic: Fast-forward', 'Merge'],
      ['rebase (finish): refs/heads/topic onto abc', 'Rebase'],
      ['reset: moving to HEAD~2', 'Reset'],
      ['cherry-pick: pick it', 'Cherry-pick'],
      ['revert: Revert "x"', 'Revert'],
      ['pull: Fast-forward', 'Pull'],
      ['something new', 'Update'],
    ];
    for (const [message, label] of cases) {
      assert.equal(describeReflogMessage(message), label, message);
    }
  });

  it('goes back to the entry before the latest one', () => {
    const operation = lastUndoableOperation([
      { sha: A, message: 'reset: moving to HEAD~2' },
      { sha: B, message: 'commit: add search' },
      { sha: C, message: 'branch: Created from HEAD' },
    ]);
    assert.deepEqual(operation, {
      label: 'Reset', message: 'reset: moving to HEAD~2', currentSha: A, previousSha: B,
    });
  });

  it('has nothing to undo for a new branch or an empty reflog', () => {
    assert.equal(lastUndoableOperation([]), undefined);
    assert.equal(lastUndoableOperation([{ sha: A, message: 'commit (initial): first' }]), undefined);
    assert.equal(
      lastUndoableOperation([{ sha: A, message: 'branch: Created from HEAD' }, { sha: B, message: 'x' }]),
      undefined,
    );
  });
});
