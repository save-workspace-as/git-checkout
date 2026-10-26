import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { initTempRepository, runGit } from '../../core/testing/gitRepoHarness';
import { listOperationRefs } from './operationFormRefs';

describe('operation form ref suggestions', () => {
  it('loads canonical local, remote, and tag names without the symbolic remote HEAD', async () => {
    const repo = initTempRepository();
    try {
      runGit(repo.repoRoot, ['commit', '--allow-empty', '-m', 'initial']);
      runGit(repo.repoRoot, ['branch', 'topic']);
      runGit(repo.repoRoot, ['tag', 'v1']);
      runGit(repo.repoRoot, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
      runGit(repo.repoRoot, ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main']);
      const refs = await listOperationRefs(repo.cli, 'HEAD~1');
      assert.ok(refs.includes('HEAD~1'));
      assert.ok(refs.includes('HEAD'));
      assert.ok(refs.includes('refs/heads/main'));
      assert.ok(refs.includes('refs/heads/topic'));
      assert.ok(refs.includes('refs/tags/v1'));
      assert.ok(refs.includes('refs/remotes/origin/main'));
      assert.equal(refs.includes('refs/remotes/origin/HEAD'), false);
    } finally {
      repo.cleanup();
    }
  });
});
