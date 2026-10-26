import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { parseCleanPreview, parseMergedBranches, parsePrunable } from './housekeepingParsers';

describe('parseMergedBranches', () => {
  it('lists merged branches, leaving out the current one, worktree branches and long-lived ones', () => {
    const output = '  feature/login\n* topic\n+ in-worktree\n  main\n  master\n  fix-typo\n\n';
    assert.deepEqual(parseMergedBranches(output), ['feature/login', 'fix-typo']);
  });

  it('ignores a detached HEAD line', () => {
    assert.deepEqual(parseMergedBranches('* (HEAD detached at abc123)\n  old\n'), ['old']);
  });
});

describe('parsePrunable', () => {
  it('reads the branches a prune would remove', () => {
    const output = "Pruning origin\nURL: git@example.com:a/b.git\n * [would prune] origin/gone\n * [would prune] origin/feature/x\n";
    assert.deepEqual(parsePrunable(output), ['origin/gone', 'origin/feature/x']);
    assert.deepEqual(parsePrunable(''), []);
  });
});

describe('parseCleanPreview', () => {
  it('reads the paths a clean would delete', () => {
    assert.deepEqual(parseCleanPreview('Would remove build/\nWould remove notes.txt\nWould skip repository sub/\n'), ['build/', 'notes.txt']);
    assert.deepEqual(parseCleanPreview(''), []);
  });
});
