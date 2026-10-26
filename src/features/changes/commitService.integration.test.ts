import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { describe, it } from 'node:test';

import { CommitService } from './commitService';
import { initTempRepository } from '../../core/testing/gitRepoHarness';
import { mockCliRegistry, mockGitExtensionService, mockRepository } from '../../core/testing/serviceTestUtils';

function gitOutput(repoRoot: string, args: string[]): string {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
}

describe('CommitService signing config', () => {
  it('writes commit.gpgsign and tag.gpgSign in the repository', async () => {
    const repo = initTempRepository();
    try {
      const service = new CommitService(
        mockGitExtensionService([mockRepository(repo.repoRoot)]),
        mockCliRegistry(repo.repoRoot, repo.cli),
      );
      await service.setSigning(repo.repoRoot, 'commit', true);
      await service.setSigning(repo.repoRoot, 'tag', true);
      assert.equal(await service.getGpgsign(repo.repoRoot), true);
      assert.equal(await service.getTagGpgSign(repo.repoRoot), true);
      assert.equal(gitOutput(repo.repoRoot, ['config', '--get', 'commit.gpgsign']), 'true');
      assert.equal(gitOutput(repo.repoRoot, ['config', '--get', 'tag.gpgSign']), 'true');

      await service.setTagGpgSign(repo.repoRoot, false);
      assert.equal(await service.getTagGpgSign(repo.repoRoot), false);
      assert.equal(gitOutput(repo.repoRoot, ['config', '--get', 'tag.gpgSign']), 'false');
    } finally {
      repo.cleanup();
    }
  });
});
