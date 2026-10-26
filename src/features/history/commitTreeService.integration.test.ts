import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { CommitTreeService } from './commitTreeService';
import { initTempRepository, runGit } from '../../core/testing/gitRepoHarness';
import { mockCliRegistry } from '../../core/testing/serviceTestUtils';

describe('CommitTreeService git ls-tree', () => {
  it('pages the recursive tree and lists a different revision', async () => {
    const repo = initTempRepository();
    try {
      writeFileSync(join(repo.repoRoot, 'a.txt'), 'a\n');
      mkdirSync(join(repo.repoRoot, 'dir'));
      writeFileSync(join(repo.repoRoot, 'dir', 'b.txt'), 'b\n');
      writeFileSync(join(repo.repoRoot, 'dir', 'c.txt'), 'c\n');
      writeFileSync(join(repo.repoRoot, 'my file.txt'), 'space\n');
      runGit(repo.repoRoot, ['add', '.']);
      runGit(repo.repoRoot, ['commit', '-m', 'files']);
      const first = (await repo.cli.execRead(['rev-parse', 'HEAD'])).stdout.trim();

      runGit(repo.repoRoot, ['rm', 'a.txt']);
      writeFileSync(join(repo.repoRoot, 'only-second.txt'), 'z\n');
      runGit(repo.repoRoot, ['add', 'only-second.txt']);
      runGit(repo.repoRoot, ['commit', '-m', 'edit']);

      const service = new CommitTreeService(mockCliRegistry(repo.repoRoot, repo.cli));
      const page = await service.list(repo.repoRoot, first);
      assert.deepEqual(page.paths, ['a.txt', 'dir/b.txt', 'dir/c.txt', 'my file.txt']);
      assert.equal(page.commit?.sha, first);
      assert.equal(page.commit?.subject, 'files');

      const head = await service.list(repo.repoRoot, 'HEAD');
      assert.equal(head.commit?.subject, 'edit');
      assert.deepEqual(head.paths, ['dir/b.txt', 'dir/c.txt', 'my file.txt', 'only-second.txt']);
    } finally {
      repo.cleanup();
    }
  });
});
