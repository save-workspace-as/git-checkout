import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CheckoutService } from './checkoutService';
import { initTempRepository, runGit } from '../../core/testing/gitRepoHarness';
import {
  mockCliRegistry,
  mockGitExtensionService,
  mockRepository,
  mockWorkingTree,
} from '../../core/testing/serviceTestUtils';

describe('CheckoutService integration', () => {
  it('detaches HEAD at a commit', async () => {
    const repo = initTempRepository();
    try {
      runGit(repo.repoRoot, ['commit', '--allow-empty', '-m', 'base']);
      const sha = (await repo.cli.execRead(['rev-parse', 'HEAD'])).stdout.trim();

      const registry = mockCliRegistry(repo.repoRoot, repo.cli);
      // Production GitCliRegistry.runWrite and GitCli.execWrite share one queue.
      // The mock skips that lock; use the real queue so a nested write fails this test.
      registry.runWrite = (root, fn) => {
        if (root !== repo.repoRoot) {
          throw new Error(`unexpected repo root: ${root}`);
        }
        return repo.cli.runWriteTask(fn);
      };
      const service = new CheckoutService(
        mockGitExtensionService([mockRepository(repo.repoRoot)]),
        registry,
        mockWorkingTree(),
      );

      const filterRef = await service.checkout(repo.repoRoot, sha, { detach: true });
      assert.equal(filterRef, sha);
      const head = (await repo.cli.execRead(['rev-parse', 'HEAD'])).stdout.trim();
      const branch = (await repo.cli.execRead(['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim();
      assert.equal(head, sha);
      assert.equal(branch, 'HEAD');
    } finally {
      repo.cleanup();
    }
  });
});
