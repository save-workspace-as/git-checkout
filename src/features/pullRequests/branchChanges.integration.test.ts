import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import { initTempRepository, runGit } from '../../core/testing/gitRepoHarness';
import { findBaseBranch, loadBranchChanges } from './branchChanges';

async function commit(repo: ReturnType<typeof initTempRepository>, file: string, text: string, message: string, body?: string): Promise<void> {
  writeFileSync(path.join(repo.repoRoot, file), text);
  await repo.cli.execWrite(['add', file]);
  await repo.cli.execWrite(['commit', '-m', message, ...(body ? ['-m', body] : [])]);
}

describe('branch changes integration', () => {
  it('finds what the branch adds to main: its commits with bodies, and one diff against where it left main', async () => {
    const repo = initTempRepository();
    try {
      await commit(repo, 'a.txt', 'one\n', 'base');
      runGit(repo.repoRoot, ['checkout', '-b', 'feat/x']);
      await commit(repo, 'a.txt', 'one\ntwo\n', 'feat: add two', 'Because two is better.');
      await commit(repo, 'b.txt', 'b\n', 'feat: add b');
      // Main moves on, which the pull request must not show as a deletion.
      runGit(repo.repoRoot, ['checkout', 'main']);
      await commit(repo, 'c.txt', 'c\n', 'main moves on');

      const changes = await loadBranchChanges(repo.cli, 'feat/x');
      assert.ok(changes);
      assert.equal(changes.base, 'main');
      assert.deepEqual(changes.commits, [
        { subject: 'feat: add b', body: '' },
        { subject: 'feat: add two', body: 'Because two is better.' },
      ]);
      assert.match(changes.diff, /\+two/);
      assert.match(changes.diff, /b\.txt/);
      assert.doesNotMatch(changes.diff, /c\.txt/, 'what main added since is not part of the branch');
    } finally {
      repo.cleanup();
    }
  });

  it('finds no commits for a branch that is level with main, and no base when there is none', async () => {
    const repo = initTempRepository();
    try {
      await commit(repo, 'a.txt', 'one\n', 'base');
      runGit(repo.repoRoot, ['branch', 'same']);
      assert.deepEqual(await loadBranchChanges(repo.cli, 'same'), { base: 'main', commits: [], diff: '' });
      assert.equal(await findBaseBranch(repo.cli, 'main'), undefined, 'main has nothing to merge into');
    } finally {
      repo.cleanup();
    }
  });

  it('prefers the default branch of the remote, and refuses a name that is an option', async () => {
    const repo = initTempRepository();
    try {
      await commit(repo, 'a.txt', 'one\n', 'base');
      runGit(repo.repoRoot, ['update-ref', 'refs/remotes/origin/trunk', 'HEAD']);
      runGit(repo.repoRoot, ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk']);
      assert.equal(await findBaseBranch(repo.cli, 'feat'), 'origin/trunk');
      await assert.rejects(loadBranchChanges(repo.cli, '--output=/tmp/x'), /Not a valid revision/);
    } finally {
      repo.cleanup();
    }
  });
});
