import { strict as assert } from 'node:assert';
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { defaultGitCheckoutSettings } from '../../core/gitCheckoutSettings';
import { initTempRepository, runGit } from '../../core/testing/gitRepoHarness';
import { mockCliRegistry, mockExtensionContext, mockGitExtensionService, mockRepository } from '../../core/testing/serviceTestUtils';
import { commitGraphHasChangedPaths } from './commitGraphFile';
import { CommitGraphService } from './commitGraphService';

function setUp(writeCommitGraph = true) {
  const repo = initTempRepository();
  runGit(repo.repoRoot, ['commit', '--allow-empty', '-m', 'one']);
  const service = new CommitGraphService(
    mockExtensionContext(),
    mockGitExtensionService([mockRepository(repo.repoRoot)], { headName: 'main' }),
    mockCliRegistry(repo.repoRoot, repo.cli),
    { ...defaultGitCheckoutSettings, gitWriteCommitGraph: () => writeCommitGraph },
  );
  const file = join(repo.repoRoot, '.git', 'objects', 'info', 'commit-graph');
  return { repo, service, file };
}

describe('commit-graph maintenance', () => {
  it('writes the commit-graph file with changed paths for a large repository that has none, and only once', async () => {
    const { repo, service, file } = setUp();
    try {
      assert.equal(existsSync(file), false);
      await service.maintainCommitGraph(repo.repoRoot, 0);
      assert.equal(commitGraphHasChangedPaths(readFileSync(file)), true);
      const written = statSync(file).mtimeMs;
      rmSync(file);
      // Asked again in the same session, it leaves the repository alone.
      await service.maintainCommitGraph(repo.repoRoot, 0);
      assert.equal(existsSync(file), false, 'not written twice in a session');
      assert.ok(written > 0);
    } finally {
      repo.cleanup();
    }
  });

  it('leaves a small repository alone, and a repository when the setting is off', async () => {
    const small = setUp();
    const off = setUp(false);
    try {
      await small.service.maintainCommitGraph(small.repo.repoRoot);
      await off.service.maintainCommitGraph(off.repo.repoRoot, 0);
      assert.equal(existsSync(small.file), false);
      assert.equal(existsSync(off.file), false);
    } finally {
      small.repo.cleanup();
      off.repo.cleanup();
    }
  });

  it('does not rewrite a commit-graph file that already has changed paths', async () => {
    const { repo, service, file } = setUp();
    try {
      runGit(repo.repoRoot, ['commit-graph', 'write', '--reachable', '--changed-paths']);
      const before = statSync(file).mtimeMs;
      await new Promise((resolve) => setTimeout(resolve, 20));
      await service.maintainCommitGraph(repo.repoRoot, 0);
      assert.equal(statSync(file).mtimeMs, before);
    } finally {
      repo.cleanup();
    }
  });

  it('writes the changed paths into a file that lacks them', async () => {
    const { repo, service, file } = setUp();
    try {
      runGit(repo.repoRoot, ['commit-graph', 'write', '--reachable', '--no-changed-paths']);
      assert.equal(commitGraphHasChangedPaths(readFileSync(file)), false);
      await service.maintainCommitGraph(repo.repoRoot, 0);
      assert.equal(commitGraphHasChangedPaths(readFileSync(file)), true);
    } finally {
      repo.cleanup();
    }
  });
});
