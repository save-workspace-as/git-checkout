import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { GIT_TEST_IDENTITY_ENV, initTempRepository, runGit } from '../../core/testing/gitRepoHarness';
import { loadBranchActivity } from './branchFilter';

const OTHER = { ...GIT_TEST_IDENTITY_ENV, GIT_AUTHOR_EMAIL: 'other@example.com', GIT_COMMITTER_EMAIL: 'other@example.com' };
const OLD = { ...GIT_TEST_IDENTITY_ENV, GIT_AUTHOR_DATE: '@1000000000', GIT_COMMITTER_DATE: '@1000000000' };

describe('loadBranchActivity integration', () => {
  it('finds the branches with your commits that the default branch lacks, and when each last changed', async () => {
    const repo = initTempRepository();
    try {
      const git = (args: string[], env = GIT_TEST_IDENTITY_ENV) => runGit(repo.repoRoot, args, env);
      git(['commit', '--allow-empty', '-m', 'base'], OTHER);
      git(['checkout', '-q', '-b', 'mine']);
      git(['commit', '--allow-empty', '-m', 'mine']);
      git(['checkout', '-q', '-b', 'stacked-by-other']);
      git(['commit', '--allow-empty', '-m', 'theirs-on-mine'], OTHER);
      git(['checkout', '-q', 'main']);
      git(['checkout', '-q', '-b', 'theirs']);
      git(['commit', '--allow-empty', '-m', 'theirs'], OTHER);
      git(['checkout', '-q', 'main']);
      git(['checkout', '-q', '-b', 'old']);
      git(['commit', '--allow-empty', '-m', 'old'], OLD);
      git(['checkout', '-q', 'main']);

      const mine = await loadBranchActivity(repo.cli, 'mine');
      assert.deepEqual([...mine].filter(([, value]) => value.mine).map(([name]) => name).sort(), ['mine', 'old', 'stacked-by-other']);
      // The default branch is never yours, even where you wrote its commits.
      assert.equal(mine.get('main')?.mine, false);
      assert.equal(mine.get('old')?.time, 1_000_000_000);

      const timesOnly = await loadBranchActivity(repo.cli, 'stale');
      assert.equal(timesOnly.get('old')?.time, 1_000_000_000);
      assert.equal(timesOnly.get('old')?.mine, false);
      assert.equal((await loadBranchActivity(repo.cli, 'all')).size, 0);
    } finally {
      repo.cleanup();
    }
  });

  it('judges by the last commit when the repository has no default branch', async () => {
    const repo = initTempRepository();
    try {
      runGit(repo.repoRoot, ['checkout', '-q', '-b', 'trunk']);
      runGit(repo.repoRoot, ['commit', '--allow-empty', '-m', 'one'], OTHER);
      runGit(repo.repoRoot, ['checkout', '-q', '-b', 'mine']);
      runGit(repo.repoRoot, ['commit', '--allow-empty', '-m', 'two']);
      const activity = await loadBranchActivity(repo.cli, 'mine');
      assert.equal(activity.get('mine')?.mine, true);
      assert.equal(activity.get('trunk')?.mine, false);
    } finally {
      repo.cleanup();
    }
  });

  it('finds nothing of yours without a configured email', async () => {
    const repo = initTempRepository();
    try {
      runGit(repo.repoRoot, ['commit', '--allow-empty', '-m', 'one']);
      runGit(repo.repoRoot, ['config', '--unset', 'user.email']);
      const activity = await loadBranchActivity(repo.cli, 'mine');
      assert.equal([...activity.values()].some((value) => value.mine), false);
    } finally {
      repo.cleanup();
    }
  });
});
