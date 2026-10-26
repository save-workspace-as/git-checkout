import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { initTempRepository, runGit, runGitAllowFailure, type TempGitRepository } from '../../core/testing/gitRepoHarness';
import { RemoteSyncService } from './remoteSyncService';
import {
  mockCliRegistry,
  mockGitExtensionService,
  mockRepository,
} from '../../core/testing/serviceTestUtils';
import { WorkingTreeService } from '../changes/workingTreeService';

function gitOutput(repoRoot: string, args: string[]): string {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
}

function serviceFor(repo: TempGitRepository): RemoteSyncService {
  const repository = mockRepository(repo.repoRoot, {
    state: {
      HEAD: { name: 'main', upstream: { name: 'origin/main' } },
      onDidChange: () => ({ dispose: () => undefined }),
    },
    pull: async () => {
      throw new Error('api pull should not run');
    },
  });
  const git = mockGitExtensionService([repository]);
  const cli = mockCliRegistry(repo.repoRoot, repo.cli);
  return new RemoteSyncService(git, cli, new WorkingTreeService(git, cli));
}

/** Remote `main` is one commit; local `main` tracks it. */
function seedTrackingPair(): { remote: TempGitRepository; local: TempGitRepository } {
  const remote = initTempRepository();
  const local = initTempRepository();
  writeFileSync(join(remote.repoRoot, 'tracked.txt'), 'base\n');
  runGit(remote.repoRoot, ['add', 'tracked.txt']);
  runGit(remote.repoRoot, ['commit', '-m', 'base']);
  runGit(local.repoRoot, ['remote', 'add', 'origin', remote.repoRoot]);
  runGit(local.repoRoot, ['config', 'protocol.file.allow', 'always']);
  runGit(local.repoRoot, ['fetch', 'origin']);
  runGit(local.repoRoot, ['checkout', '-B', 'main', 'origin/main']);
  return { remote, local };
}

function fetchService(repo: TempGitRepository): RemoteSyncService {
  const repository = mockRepository(repo.repoRoot, {
    fetch: async () => {
      throw new Error('api fetch should not run');
    },
  });
  const git = mockGitExtensionService([repository]);
  const cli = mockCliRegistry(repo.repoRoot, repo.cli);
  return new RemoteSyncService(git, cli, new WorkingTreeService(git, cli));
}

describe('RemoteSyncService.fetch integration', () => {
  it('updates the chosen remote and every remote', async () => {
    const local = initTempRepository();
    const origin = initTempRepository();
    const upstream = initTempRepository();
    try {
      writeFileSync(join(origin.repoRoot, 'tracked.txt'), 'base\n');
      runGit(origin.repoRoot, ['add', 'tracked.txt']);
      runGit(origin.repoRoot, ['commit', '-m', 'base']);
      runGit(local.repoRoot, ['remote', 'add', 'origin', origin.repoRoot]);
      runGit(local.repoRoot, ['remote', 'add', 'upstream', upstream.repoRoot]);
      runGit(local.repoRoot, ['config', 'protocol.file.allow', 'always']);
      runGit(local.repoRoot, ['fetch', 'origin']);
      runGit(local.repoRoot, ['checkout', '-B', 'main', 'origin/main']);

      writeFileSync(join(origin.repoRoot, 'from-origin.txt'), 'origin\n');
      runGit(origin.repoRoot, ['add', 'from-origin.txt']);
      runGit(origin.repoRoot, ['commit', '-m', 'origin-commit']);
      writeFileSync(join(upstream.repoRoot, 'from-upstream.txt'), 'upstream\n');
      runGit(upstream.repoRoot, ['add', 'from-upstream.txt']);
      runGit(upstream.repoRoot, ['commit', '-m', 'upstream-commit']);

      await fetchService(local).fetch(local.repoRoot, { remote: 'origin' });
      assert.equal(gitOutput(local.repoRoot, ['show', 'origin/main:from-origin.txt']), 'origin');
      assert.notEqual(
        runGitAllowFailure(local.repoRoot, ['show', 'upstream/main:from-upstream.txt']),
        0,
      );

      await fetchService(local).fetch(local.repoRoot, { all: true });
      assert.equal(
        gitOutput(local.repoRoot, ['show', 'upstream/main:from-upstream.txt']),
        'upstream',
      );
    } finally {
      local.cleanup();
      origin.cleanup();
      upstream.cleanup();
    }
  });
});

describe('RemoteSyncService.pull integration', () => {
  it('rebases the current branch onto the chosen remote branch', async () => {
    const { remote, local } = seedTrackingPair();
    try {
      writeFileSync(join(local.repoRoot, 'local.txt'), 'local\n');
      runGit(local.repoRoot, ['add', 'local.txt']);
      runGit(local.repoRoot, ['commit', '-m', 'local']);

      writeFileSync(join(remote.repoRoot, 'remote.txt'), 'remote\n');
      runGit(remote.repoRoot, ['add', 'remote.txt']);
      runGit(remote.repoRoot, ['commit', '-m', 'remote']);

      await serviceFor(local).pull(local.repoRoot, {
        remote: 'origin',
        branch: 'main',
        rebase: true,
        stash: false,
      });

      assert.equal(gitOutput(local.repoRoot, ['rev-list', '--merges', '--count', 'HEAD']), '0');
      assert.equal(gitOutput(local.repoRoot, ['log', '-1', '--format=%s']), 'local');
      assert.equal(gitOutput(local.repoRoot, ['log', '-2', '--format=%s']).split('\n')[1], 'remote');
      assert.equal(gitOutput(local.repoRoot, ['merge-base', '--is-ancestor', 'origin/main', 'HEAD']), '');
    } finally {
      remote.cleanup();
      local.cleanup();
    }
  });

  it('fast-forwards another local branch from the remote without touching the working tree', async () => {
    const { remote, local } = seedTrackingPair();
    try {
      runGit(local.repoRoot, ['branch', 'other', 'main']);
      writeFileSync(join(remote.repoRoot, 'remote.txt'), 'remote\n');
      runGit(remote.repoRoot, ['add', 'remote.txt']);
      runGit(remote.repoRoot, ['commit', '-m', 'remote']);
      const before = gitOutput(local.repoRoot, ['rev-parse', 'main']);

      await serviceFor(local).pull(local.repoRoot, { remote: 'origin', branch: 'main', into: 'other' });

      assert.equal(gitOutput(local.repoRoot, ['show', 'other:remote.txt']), 'remote');
      assert.equal(gitOutput(local.repoRoot, ['rev-parse', 'main']), before, 'the checked-out branch stays');
      assert.equal(gitOutput(local.repoRoot, ['branch', '--show-current']), 'main');
      assert.equal(gitOutput(local.repoRoot, ['status', '--porcelain']), '');
    } finally {
      local.cleanup();
      remote.cleanup();
    }
  });

  it('refuses to move another local branch that has commits of its own, and leaves it where it was', async () => {
    const { remote, local } = seedTrackingPair();
    try {
      runGit(local.repoRoot, ['checkout', '-b', 'other']);
      writeFileSync(join(local.repoRoot, 'mine.txt'), 'mine\n');
      runGit(local.repoRoot, ['add', 'mine.txt']);
      runGit(local.repoRoot, ['commit', '-m', 'mine']);
      runGit(local.repoRoot, ['checkout', 'main']);
      writeFileSync(join(remote.repoRoot, 'remote.txt'), 'remote\n');
      runGit(remote.repoRoot, ['add', 'remote.txt']);
      runGit(remote.repoRoot, ['commit', '-m', 'remote']);
      const before = gitOutput(local.repoRoot, ['rev-parse', 'other']);

      await assert.rejects(serviceFor(local).pull(local.repoRoot, { remote: 'origin', branch: 'main', into: 'other' }));
      assert.equal(gitOutput(local.repoRoot, ['rev-parse', 'other']), before);
    } finally {
      local.cleanup();
      remote.cleanup();
    }
  });

  it('stashes tracked edits, pulls, and restores them', async () => {
    const { remote, local } = seedTrackingPair();
    try {
      writeFileSync(join(local.repoRoot, 'tracked.txt'), 'local edit\n');
      writeFileSync(join(remote.repoRoot, 'remote.txt'), 'remote\n');
      runGit(remote.repoRoot, ['add', 'remote.txt']);
      runGit(remote.repoRoot, ['commit', '-m', 'remote']);

      await serviceFor(local).pull(local.repoRoot, {
        remote: 'origin',
        branch: 'main',
        rebase: false,
        stash: true,
      });

      assert.equal(gitOutput(local.repoRoot, ['show', 'HEAD:remote.txt']), 'remote');
      assert.match(gitOutput(local.repoRoot, ['status', '--porcelain']), /tracked\.txt/);
      assert.equal(gitOutput(local.repoRoot, ['stash', 'list']), '');
    } finally {
      remote.cleanup();
      local.cleanup();
    }
  });
});

function pushService(repo: TempGitRepository): RemoteSyncService {
  const repository = mockRepository(repo.repoRoot, {
    state: {
      HEAD: { name: 'main' },
      onDidChange: () => ({ dispose: () => undefined }),
    },
    push: async () => {
      throw new Error('api push should not run');
    },
  });
  const git = mockGitExtensionService([repository]);
  const cli = mockCliRegistry(repo.repoRoot, repo.cli);
  // Production GitCliRegistry.runWrite and GitCli.execWrite share one queue.
  // The mock skips that lock; use the real queue so a nested write fails this test.
  cli.runWrite = (root, fn) => {
    if (root !== repo.repoRoot) {
      throw new Error(`unexpected repo root: ${root}`);
    }
    return repo.cli.runWriteTask(fn);
  };
  return new RemoteSyncService(git, cli, new WorkingTreeService(git, cli));
}

describe('RemoteSyncService.push integration', () => {
  it('pushes the selected branch, sets upstream, and sends every tag', async () => {
    const local = initTempRepository();
    const bareRoot = mkdtempSync(join(tmpdir(), 'git-checkout-int-bare-'));
    try {
      runGit(bareRoot, ['init', '--bare', '-b', 'main']);
      writeFileSync(join(local.repoRoot, 'tracked.txt'), 'base\n');
      runGit(local.repoRoot, ['add', 'tracked.txt']);
      runGit(local.repoRoot, ['commit', '-m', 'track']);
      runGit(local.repoRoot, ['tag', 'v1']);
      runGit(local.repoRoot, ['remote', 'add', 'origin', bareRoot]);
      runGit(local.repoRoot, ['config', 'protocol.file.allow', 'always']);

      await pushService(local).push(local.repoRoot, {
        remote: 'origin',
        branch: 'main',
        tags: true,
        setUpstream: true,
      });

      assert.equal(gitOutput(bareRoot, ['log', '-1', '--format=%s']), 'track');
      assert.equal(gitOutput(bareRoot, ['tag', '-l', 'v1']), 'v1');
      assert.equal(
        gitOutput(local.repoRoot, ['rev-parse', '--abbrev-ref', '@{upstream}']),
        'origin/main',
      );
    } finally {
      local.cleanup();
      rmSync(bareRoot, { recursive: true, force: true });
    }
  });

  it('updates a diverged remote branch with force-with-lease', async () => {
    const local = initTempRepository();
    const other = initTempRepository();
    const bareRoot = mkdtempSync(join(tmpdir(), 'git-checkout-int-bare-'));
    try {
      runGit(bareRoot, ['init', '--bare', '-b', 'main']);
      writeFileSync(join(local.repoRoot, 'tracked.txt'), 'base\n');
      runGit(local.repoRoot, ['add', 'tracked.txt']);
      runGit(local.repoRoot, ['commit', '-m', 'base']);
      runGit(local.repoRoot, ['remote', 'add', 'origin', bareRoot]);
      runGit(local.repoRoot, ['config', 'protocol.file.allow', 'always']);
      await pushService(local).push(local.repoRoot, { remote: 'origin', branch: 'main' });

      runGit(other.repoRoot, ['remote', 'add', 'origin', bareRoot]);
      runGit(other.repoRoot, ['config', 'protocol.file.allow', 'always']);
      runGit(other.repoRoot, ['fetch', 'origin']);
      runGit(other.repoRoot, ['checkout', '-B', 'main', 'origin/main']);
      writeFileSync(join(other.repoRoot, 'remote.txt'), 'remote\n');
      runGit(other.repoRoot, ['add', 'remote.txt']);
      runGit(other.repoRoot, ['commit', '-m', 'remote']);
      runGit(other.repoRoot, ['push', 'origin', 'main']);

      runGit(local.repoRoot, ['fetch', 'origin']);
      writeFileSync(join(local.repoRoot, 'local.txt'), 'local\n');
      runGit(local.repoRoot, ['add', 'local.txt']);
      runGit(local.repoRoot, ['commit', '-m', 'local']);
      assert.notEqual(runGitAllowFailure(local.repoRoot, ['push', 'origin', 'main']), 0);

      await pushService(local).push(local.repoRoot, {
        remote: 'origin',
        branch: 'main',
        forceWithLease: true,
      });

      assert.equal(gitOutput(bareRoot, ['log', '-1', '--format=%s']), 'local');
      assert.equal(gitOutput(bareRoot, ['show', 'HEAD:local.txt']), 'local');
      assert.notEqual(runGitAllowFailure(bareRoot, ['cat-file', '-e', 'HEAD:remote.txt']), 0);
    } finally {
      local.cleanup();
      other.cleanup();
      rmSync(bareRoot, { recursive: true, force: true });
    }
  });
});
