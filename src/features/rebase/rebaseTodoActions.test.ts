import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildPickLines } from './rebaseTodo';
import {
  applyAutosquashCommands,
  combineSelected,
  reorderCommitLines,
  squashLastN,
} from './rebaseTodoActions';

describe('rebaseTodoActions', () => {
  const base = buildPickLines([
    { hash: 'a', subject: 'one' },
    { hash: 'b', subject: 'two' },
    { hash: 'c', subject: 'fixup! two' },
  ]);

  it('squashLastN marks trailing commits', () => {
    const out = squashLastN(base, 2, 'fixup');
    const commits = out.filter((l) => l.kind === 'commit');
    assert.equal(commits[1].command, 'pick');
    assert.equal(commits[2].command, 'fixup');
  });

  it('combineSelected squashes selection', () => {
    const out = combineSelected(base, new Set(['b', 'c']), 'squash');
    const commits = out.filter((l) => l.kind === 'commit');
    assert.equal(commits[0].command, 'pick');
    assert.equal(commits[1].command, 'pick');
    assert.equal(commits[2].command, 'squash');
  });

  it('applyAutosquashCommands maps fixup subjects', () => {
    const out = applyAutosquashCommands(base);
    const commits = out.filter((l) => l.kind === 'commit');
    assert.equal(commits[2].command, 'fixup');
  });

  it('reorderCommitLines moves commits', () => {
    const out = reorderCommitLines(base, 0, 2);
    const commits = out.filter((l) => l.kind === 'commit');
    assert.deepEqual(
      commits.map((c) => c.hash),
      ['b', 'c', 'a'],
    );
  });
});
