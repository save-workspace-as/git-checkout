import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { buildSidebarTree } from '../../ui/sidebarTreeModel';
import { createTestGitCli, initTempRepository, runGit } from '../../core/testing/gitRepoHarness';
import { mockCliRegistry } from '../../core/testing/serviceTestUtils';
import { parseWorktreeCreateArg } from './worktreeCreate';
import { WorktreeService } from './worktreeService';

describe('worktree integration', () => {
  it('lists, creates, and deletes a linked worktree from the common repository', async () => {
    const repo = initTempRepository();
    const linked = join(repo.repoRoot, 'linked');
    try {
      runGit(repo.repoRoot, ['commit', '--allow-empty', '-m', 'init']);
      const svc = new WorktreeService(mockCliRegistry(repo.repoRoot, repo.cli));

      await svc.add(repo.repoRoot, { path: linked, newBranch: 'feature' });
      const listed = await svc.list(repo.repoRoot);
      const feature = listed.find((entry) => entry.branch === 'refs/heads/feature');
      assert.ok(feature);
      assert.equal(feature.current, false);
      assert.equal(listed.find((entry) => entry.branch === 'refs/heads/main')?.current, true);
      assert.equal(existsSync(linked), true);

      const mainDirs = await repo.cli.resolveGitDirectories();
      const linkedCli = createTestGitCli(linked);
      const linkedDirs = await linkedCli.resolveGitDirectories();
      assert.equal(linkedDirs.commonDir, mainDirs.commonDir);
      assert.notEqual(linkedDirs.gitDir, linkedDirs.commonDir);
      assert.equal(
        (await linkedCli.execRead(['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim(),
        'feature',
      );

      const inherited = process.env.GIT_DIR;
      process.env.GIT_DIR = mainDirs.commonDir;
      try {
        assert.equal(
          (await linkedCli.execRead(['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim(),
          'feature',
        );
      } finally {
        if (inherited === undefined) {
          delete process.env.GIT_DIR;
        } else {
          process.env.GIT_DIR = inherited;
        }
      }

      const tree = buildSidebarTree(
        {
          branches: [
            {
              name: 'main',
              shortSha: 'abc',
              upstream: null,
              upstreamTrack: null,
              isHead: true,
            },
            {
              name: 'feature',
              shortSha: 'def',
              upstream: null,
              upstreamTrack: null,
              isHead: false,
            },
          ],
          remoteBranches: [],
          tags: [],
          remotes: [],
          filterRef: 'HEAD',
          headRef: 'main',
        },
        { dirty: false, stagedCount: 0, unstagedCount: 0 },
        [],
        listed,
      );
      const featureNode = tree
        .find((node) => node.id === 'section:branches')
        ?.children.find((node) => node.ref === 'feature');
      assert.equal(featureNode?.checkedOutElsewhere, true);
      assert.equal(featureNode?.description, 'checked out');
      const worktrees = tree.find((node) => node.id === 'section:worktrees');
      assert.deepEqual(
        worktrees?.children.map((node) => node.label),
        ['main', 'feature'],
      );

      await svc.remove(repo.repoRoot, linked, true);
      assert.equal(existsSync(linked), false);
      assert.equal(
        (await svc.list(repo.repoRoot)).some((entry) => entry.branch === 'refs/heads/feature'),
        false,
      );
    } finally {
      repo.cleanup();
    }
  });

  it('checks out a new branch in the worktree from the chosen start ref', async () => {
    const repo = initTempRepository();
    const linked = join(repo.repoRoot, 'topic-wt');
    try {
      runGit(repo.repoRoot, ['commit', '--allow-empty', '-m', 'init']);
      runGit(repo.repoRoot, ['branch', 'source']);
      runGit(repo.repoRoot, ['commit', '--allow-empty', '-m', 'main-only']);
      const parsed = parseWorktreeCreateArg(
        { path: linked, newBranch: 'topic', startPoint: 'source' },
        {
          repoRoot: repo.repoRoot,
          branchNames: ['main', 'source'],
          worktrees: [{ path: repo.repoRoot, branch: 'refs/heads/main' }],
        },
      );
      assert.equal(parsed.status, 'ready');
      if (parsed.status !== 'ready') {
        return;
      }
      await new WorktreeService(mockCliRegistry(repo.repoRoot, repo.cli)).add(repo.repoRoot, parsed.request);
      const linkedCli = createTestGitCli(linked);
      assert.equal((await linkedCli.execRead(['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim(), 'topic');
      assert.equal(
        (await linkedCli.execRead(['rev-parse', 'HEAD'])).stdout.trim(),
        (await repo.cli.execRead(['rev-parse', 'source'])).stdout.trim(),
      );
      assert.notEqual(
        (await linkedCli.execRead(['rev-parse', 'HEAD'])).stdout.trim(),
        (await repo.cli.execRead(['rev-parse', 'main'])).stdout.trim(),
      );
      assert.equal((await repo.cli.execRead(['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim(), 'main');
    } finally {
      repo.cleanup();
    }
  });
});
