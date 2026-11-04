import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import { initTempRepository, runGit } from '../../core/testing/gitRepoHarness';
import { loadCommitForExplain } from './commitExplainSource';

type Repo = ReturnType<typeof initTempRepository>;

async function commit(repo: Repo, file: string, text: string, message: string, body?: string): Promise<void> {
  writeFileSync(path.join(repo.repoRoot, file), text);
  await repo.cli.execWrite(['add', file]);
  await repo.cli.execWrite(['commit', '-m', message, ...(body ? ['-m', body] : [])]);
}

describe('commit explain source integration', () => {
  it('reads the message and the diff of a commit, and of the first commit of a repository', async () => {
    const repo = initTempRepository();
    try {
      await commit(repo, 'a.txt', 'one\n', 'first');
      await commit(repo, 'a.txt', 'one\ntwo\n', 'feat: add two', 'Because two.');
      const second = await loadCommitForExplain(repo.cli, 'HEAD');
      assert.equal(second.sha, (await repo.cli.execRead(['rev-parse', 'HEAD'])).stdout.trim());
      assert.equal(second.message, 'feat: add two\n\nBecause two.');
      assert.match(second.diff, /\+two/);
      assert.match(second.diff, /a\.txt \| 1 \+/);

      const first = await loadCommitForExplain(repo.cli, 'HEAD~1');
      assert.match(first.diff, /new file mode/);
    } finally {
      repo.cleanup();
    }
  });

  it('shows a merge against its first parent, so it lists what the other side brought in', async () => {
    const repo = initTempRepository();
    try {
      await commit(repo, 'a.txt', 'one\n', 'base');
      runGit(repo.repoRoot, ['checkout', '-b', 'topic']);
      await commit(repo, 'topic.txt', 'topic\n', 'topic work');
      runGit(repo.repoRoot, ['checkout', 'main']);
      await commit(repo, 'main.txt', 'main\n', 'main work');
      await repo.cli.execWrite(['merge', '--no-ff', '-m', 'merge topic', 'topic']);
      const merge = await loadCommitForExplain(repo.cli, 'HEAD');
      assert.match(merge.diff, /topic\.txt/);
      assert.doesNotMatch(merge.diff, /main\.txt/);
    } finally {
      repo.cleanup();
    }
  });

  it('refuses a revision that is an option, and one that is not a commit', async () => {
    const repo = initTempRepository();
    try {
      await commit(repo, 'a.txt', 'one\n', 'base');
      await assert.rejects(loadCommitForExplain(repo.cli, '--output=/tmp/x'), /Not a valid revision/);
      await assert.rejects(loadCommitForExplain(repo.cli, 'no-such-ref'));
    } finally {
      repo.cleanup();
    }
  });
});
