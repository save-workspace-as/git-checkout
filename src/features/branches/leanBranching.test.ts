import { AUTO_STASH_MESSAGE_PATTERN } from './autoStash';
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import type { GitCli } from '../../core/gitCli';
import { withLeanStash } from './leanBranching';
import type { WorkingTreeService } from '../changes/workingTreeService';

function mockCli(): { cli: GitCli; writes: string[][] } {
  const writes: string[][] = [];
  const cli = {
    execWrite: async (args: string[]) => {
      writes.push(args);
    },
  } as unknown as GitCli;
  return { cli, writes };
}

function mockWorkingTree(dirty: boolean): WorkingTreeService {
  return {
    getStatus: async () => ({
      dirty,
      stagedCount: dirty ? 1 : 0,
      unstagedCount: 0,
    }),
    hasStagedChanges: async () => dirty,
  } as unknown as WorkingTreeService;
}

describe('withLeanStash', () => {
  it('runs the callback when lean stash is disabled', async () => {
    const { cli, writes } = mockCli();
    let ran = false;
    await withLeanStash('/repo', false, mockWorkingTree(true), cli, async () => {
      ran = true;
    });
    assert.equal(ran, true);
    assert.deepEqual(writes, []);
  });

  it('skips stash when the tree is clean', async () => {
    const { cli, writes } = mockCli();
    await withLeanStash('/repo', true, mockWorkingTree(false), cli, async () => undefined);
    assert.deepEqual(writes, []);
  });

  it('stash push, callback, then pop when dirty and enabled', async () => {
    const { cli, writes } = mockCli();
    const steps: string[] = [];
    await withLeanStash('/repo', true, mockWorkingTree(true), cli, async () => {
      steps.push('work');
    });
    assert.deepEqual(steps, ['work']);
    assert.deepEqual(writes.map((write) => write.slice(0, 3)), [['stash', 'push', '-m'], ['stash', 'pop']]);
    assert.match(writes[0][3], AUTO_STASH_MESSAGE_PATTERN);
  });
});
