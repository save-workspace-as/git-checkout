import { strict as assert } from 'node:assert';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { initTempRepository, runGit } from '../../core/testing/gitRepoHarness';
import { remoteRef } from './remoteRef';

async function commit(repo: ReturnType<typeof initTempRepository>, name: string): Promise<string> {
  writeFileSync(join(repo.repoRoot, name), `${name}\n`);
  runGit(repo.repoRoot, ['add', name]);
  await repo.cli.execWrite(['commit', '-m', name]);
  return (await repo.cli.execRead(['rev-parse', 'HEAD'])).stdout.trim();
}

describe('remoteRef', () => {
  it('uses the commit once a remote branch has it', async () => {
    const repo = initTempRepository();
    try {
      const head = await commit(repo, 'a.txt');
      runGit(repo.repoRoot, ['update-ref', 'refs/remotes/origin/main', head]);
      assert.equal(await remoteRef(repo.cli), head);
    } finally {
      repo.cleanup();
    }
  });

  it('uses the upstream branch name for a commit that is not pushed', async () => {
    const repo = initTempRepository();
    try {
      const first = await commit(repo, 'a.txt');
      runGit(repo.repoRoot, ['update-ref', 'refs/remotes/origin/trunk', first]);
      runGit(repo.repoRoot, ['config', 'remote.origin.url', 'https://example.test/x.git']);
      runGit(repo.repoRoot, ['config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*']);
      runGit(repo.repoRoot, ['config', 'branch.main.remote', 'origin']);
      runGit(repo.repoRoot, ['config', 'branch.main.merge', 'refs/heads/trunk']);
      await commit(repo, 'b.txt');
      assert.equal(await remoteRef(repo.cli), 'trunk');
    } finally {
      repo.cleanup();
    }
  });

  it('uses the branch name when there is no upstream, and the commit when HEAD is detached', async () => {
    const repo = initTempRepository();
    try {
      const head = await commit(repo, 'a.txt');
      assert.equal(await remoteRef(repo.cli), 'main');
      runGit(repo.repoRoot, ['checkout', '-q', '--detach', head]);
      assert.equal(await remoteRef(repo.cli), head);
    } finally {
      repo.cleanup();
    }
  });
});
