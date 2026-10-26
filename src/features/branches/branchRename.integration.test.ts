import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { executeBranchRename, readBranchUpstream } from './branchRename';
import { initTempRepository, runGit, runGitAllowFailure, type TempGitRepository } from '../../core/testing/gitRepoHarness';

function gitOutput(repoRoot: string, args: string[]): string {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
}

function seedTrackingBranch(): { remoteRoot: string; local: TempGitRepository } {
  const remoteRoot = mkdtempSync(join(tmpdir(), 'git-checkout-int-remote-'));
  runGit(remoteRoot, ['init', '--bare', '-b', 'main']);
  const local = initTempRepository();
  runGit(local.repoRoot, ['commit', '--allow-empty', '-m', 'init']);
  runGit(local.repoRoot, ['remote', 'add', 'origin', remoteRoot]);
  runGit(local.repoRoot, ['config', 'protocol.file.allow', 'always']);
  runGit(local.repoRoot, ['push', '-u', 'origin', 'main']);
  runGit(local.repoRoot, ['checkout', '-b', 'feature']);
  runGit(local.repoRoot, ['push', '-u', 'origin', 'feature']);
  return { remoteRoot, local };
}

describe('executeBranchRename integration', () => {
  it('renames the local branch and leaves the remote branch in place', async () => {
    const { remoteRoot, local } = seedTrackingBranch();
    try {
      const upstream = await readBranchUpstream(local.cli, 'feature');
      assert.deepEqual(upstream, { remote: 'origin', branch: 'feature' });
      await executeBranchRename(
        local.cli,
        'feature',
        { name: 'feature-next', renameRemote: false },
        upstream,
      );
      assert.equal(gitOutput(local.repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']), 'feature-next');
      assert.equal(
        gitOutput(local.repoRoot, ['rev-parse', '--abbrev-ref', 'feature-next@{upstream}']),
        'origin/feature',
      );
      assert.equal(
        gitOutput(remoteRoot, ['rev-parse', '--verify', 'refs/heads/feature']),
        gitOutput(local.repoRoot, ['rev-parse', 'HEAD']),
      );
      assert.notEqual(runGitAllowFailure(remoteRoot, ['rev-parse', '--verify', 'refs/heads/feature-next']), 0);
    } finally {
      local.cleanup();
      rmSync(remoteRoot, { recursive: true, force: true });
    }
  });

  it('renames the remote tracking branch when asked', async () => {
    const { remoteRoot, local } = seedTrackingBranch();
    try {
      const upstream = await readBranchUpstream(local.cli, 'feature');
      await executeBranchRename(
        local.cli,
        'feature',
        { name: 'feature-next', renameRemote: true },
        upstream,
      );
      assert.equal(gitOutput(local.repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']), 'feature-next');
      assert.equal(
        gitOutput(local.repoRoot, ['rev-parse', '--abbrev-ref', 'feature-next@{upstream}']),
        'origin/feature-next',
      );
      assert.equal(
        gitOutput(remoteRoot, ['rev-parse', '--verify', 'refs/heads/feature-next']),
        gitOutput(local.repoRoot, ['rev-parse', 'HEAD']),
      );
      assert.notEqual(runGitAllowFailure(remoteRoot, ['rev-parse', '--verify', 'refs/heads/feature']), 0);
    } finally {
      local.cleanup();
      rmSync(remoteRoot, { recursive: true, force: true });
    }
  });
});
