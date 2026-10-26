import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { mockCliRegistry, mockGitCli } from '../../core/testing/serviceTestUtils';
import { WorktreeService } from './worktreeService';

const REPO = '/repos/main';

describe('WorktreeService', () => {
  it('parses porcelain from git worktree list', async () => {
    const { cli, reads } = mockGitCli({
      execRead: async () => ({
        stdout: 'worktree /repos/main\nHEAD abc\nbranch refs/heads/main\n',
      }),
    });
    const entries = await new WorktreeService(mockCliRegistry(REPO, cli)).list(REPO);
    assert.deepEqual(reads, [['worktree', 'list', '--porcelain']]);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].current, true);
    assert.equal(entries[0].branch, 'refs/heads/main');
  });

  it('adds an existing branch and a new branch', async () => {
    const { cli, writes } = mockGitCli();
    const svc = new WorktreeService(mockCliRegistry(REPO, cli));
    await svc.add(REPO, { path: '/repos/feature', startPoint: 'feature' });
    await svc.add(REPO, { path: '/repos/topic', newBranch: 'topic', startPoint: 'main' });
    assert.deepEqual(writes, [
      ['worktree', 'add', '/repos/feature', 'feature'],
      ['worktree', 'add', '-b', 'topic', '/repos/topic', 'main'],
    ]);
  });

  it('refuses to create a worktree at the current folder', async () => {
    const { cli, writes } = mockGitCli();
    await assert.rejects(
      () => new WorktreeService(mockCliRegistry(REPO, cli)).add(REPO, { path: `${REPO}/` }),
      /current worktree/,
    );
    assert.deepEqual(writes, []);
  });

  it('removes a worktree and optionally deinits submodules first', async () => {
    const { cli, writes } = mockGitCli();
    const svc = new WorktreeService(mockCliRegistry(REPO, cli));
    await svc.remove(REPO, '/repos/feature', false);
    await svc.remove(REPO, '/repos/feature', true);
    assert.deepEqual(writes, [
      ['worktree', 'remove', '/repos/feature'],
      ['-C', '/repos/feature', 'submodule', 'deinit', '--all', '--force'],
      ['worktree', 'remove', '/repos/feature'],
    ]);
  });

  it('refuses to delete the current worktree', async () => {
    const { cli, writes } = mockGitCli();
    await assert.rejects(
      () => new WorktreeService(mockCliRegistry(REPO, cli)).remove(REPO, REPO, true),
      /cannot be deleted/,
    );
    assert.deepEqual(writes, []);
  });
});
