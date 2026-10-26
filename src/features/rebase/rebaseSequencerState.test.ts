import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { readRebaseSequencerState } from './rebaseSequencerState';

describe('rebaseSequencerState', () => {
  it('reads progress from rebase-merge metadata', () => {
    const dir = join(
      process.env.TMPDIR ?? '/tmp/gh-aw/agent',
      `rebase-seq-${Date.now()}`,
    );
    const mergeDir = join(dir, 'rebase-merge');
    mkdirSync(mergeDir, { recursive: true });
    writeFileSync(join(mergeDir, 'git-rebase-todo'), 'pick abcdef1 subject\n');
    writeFileSync(join(mergeDir, 'done'), 'pick 1111111 done\n');
    writeFileSync(join(mergeDir, 'onto'), '2222222\n');
    writeFileSync(join(mergeDir, 'head-name'), 'refs/heads/main\n');
    writeFileSync(join(mergeDir, 'msgnum'), '2\n');
    writeFileSync(join(mergeDir, 'end'), '3\n');

    const state = readRebaseSequencerState(dir);
    assert.ok(state?.active);
    assert.equal(state?.onto, '2222222');
    assert.equal(state?.end, 3);
    assert.equal(state?.remaining.length, 1);
    assert.equal(state?.done.length, 1);
  });

  it('reports active state for rebase-apply', () => {
    const dir = join(
      process.env.TMPDIR ?? '/tmp/gh-aw/agent',
      `rebase-apply-${Date.now()}`,
    );
    const applyDir = join(dir, 'rebase-apply');
    mkdirSync(applyDir, { recursive: true });
    writeFileSync(join(applyDir, 'head-name'), 'refs/heads/main\n');

    const state = readRebaseSequencerState(dir);
    assert.ok(state?.active);
    assert.match(state?.summary ?? '', /Rebase in progress/);
  });
});
