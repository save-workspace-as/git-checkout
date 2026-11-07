import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import { initTempRepository, runGit } from '../../core/testing/gitRepoHarness';
import { baseBranchName, loadStackCommits, MAX_STACK_COMMITS } from './stackCommits';

type Repo = ReturnType<typeof initTempRepository>;

async function commit(repo: Repo, file: string, message: string, body?: string): Promise<string> {
  writeFileSync(path.join(repo.repoRoot, file), `${message}\n`);
  await repo.cli.execWrite(['add', file]);
  await repo.cli.execWrite(['commit', '-m', message, ...(body ? ['-m', body] : [])]);
  return (await repo.cli.execRead(['rev-parse', 'HEAD'])).stdout.trim();
}

describe('stack commits integration', () => {
  it('lists the commits beyond main oldest first, with the branches that already end at one', async () => {
    const repo = initTempRepository();
    try {
      await commit(repo, 'a.txt', 'base');
      runGit(repo.repoRoot, ['checkout', '-b', 'feat/x']);
      const first = await commit(repo, 'b.txt', 'add schema', 'Because.');
      runGit(repo.repoRoot, ['branch', 'feat/x-schema']);
      await commit(repo, 'c.txt', 'add api');
      await commit(repo, 'd.txt', 'add page');

      const result = await loadStackCommits(repo.cli, 'feat/x');
      assert.equal(result.kind, 'commits');
      if (result.kind !== 'commits') { return; }
      assert.equal(result.base, 'main');
      assert.deepEqual(result.commits.map((c) => [c.subject, c.body, c.branches]), [
        ['add schema', 'Because.', ['feat/x-schema']],
        ['add api', '', []],
        ['add page', '', []],
      ]);
      assert.equal(result.commits[0].sha, first);
    } finally {
      repo.cleanup();
    }
  });

  it('has no commits for a branch level with main, and no base when there is none', async () => {
    const repo = initTempRepository();
    try {
      await commit(repo, 'a.txt', 'base');
      runGit(repo.repoRoot, ['branch', 'same']);
      assert.deepEqual(await loadStackCommits(repo.cli, 'same'), { kind: 'commits', base: 'main', commits: [] });
      assert.deepEqual(await loadStackCommits(repo.cli, 'main'), { kind: 'noBase' });
    } finally {
      repo.cleanup();
    }
  });

  it('declines a branch with a merge commit, and one with too many commits', async () => {
    const repo = initTempRepository();
    try {
      await commit(repo, 'a.txt', 'base');
      runGit(repo.repoRoot, ['checkout', '-b', 'side']);
      await commit(repo, 's.txt', 'side');
      runGit(repo.repoRoot, ['checkout', '-b', 'feat/y', 'main']);
      await commit(repo, 'y.txt', 'y');
      runGit(repo.repoRoot, ['merge', '--no-ff', '-m', 'merge side', 'side']);
      assert.deepEqual(await loadStackCommits(repo.cli, 'feat/y'), { kind: 'merges', base: 'main' });

      runGit(repo.repoRoot, ['checkout', '-b', 'long', 'main']);
      for (let n = 0; n <= MAX_STACK_COMMITS; n++) {
        runGit(repo.repoRoot, ['commit', '--allow-empty', '-m', `c${n}`]);
      }
      assert.deepEqual(await loadStackCommits(repo.cli, 'long'), { kind: 'tooMany', base: 'main', count: MAX_STACK_COMMITS + 1 });
    } finally {
      repo.cleanup();
    }
  });

  it('refuses a branch name that is an option', async () => {
    const repo = initTempRepository();
    try {
      await assert.rejects(() => loadStackCommits(repo.cli, '--all'));
    } finally {
      repo.cleanup();
    }
  });

  it('reads the base on the remote as its own branch name', () => {
    assert.equal(baseBranchName('origin/main', 'origin'), 'main');
    assert.equal(baseBranchName('origin/release/1', 'origin'), 'release/1');
    assert.equal(baseBranchName('main', 'origin'), 'main');
  });
});
