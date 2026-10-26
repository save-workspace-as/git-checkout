import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import type { GitCheckoutSettingsReader } from '../../core/gitCheckoutSettings';
import { defaultGitCheckoutSettings } from '../../core/gitCheckoutSettings';
import { RemoteSyncService } from './remoteSyncService';
import {
  mockCliRegistry,
  mockGitCli,
  mockGitExtensionService,
  mockRepository,
  mockWorkingTree,
} from '../../core/testing/serviceTestUtils';

const REPO = '/repo';

function settings(overrides: Partial<GitCheckoutSettingsReader>): GitCheckoutSettingsReader {
  return { ...defaultGitCheckoutSettings, ...overrides };
}

describe('RemoteSyncService.getSyncStatus', () => {
  it('reads ahead/behind from vscode.git state when present', async () => {
    const { cli } = mockGitCli();
    const repo = mockRepository(REPO, {
      state: {
        HEAD: {
          name: 'main',
          upstream: { name: 'origin/main' },
          ahead: 2,
          behind: 1,
        },
        onDidChange: () => ({ dispose: () => undefined }),
      },
    });
    const svc = new RemoteSyncService(
      mockGitExtensionService([repo]),
      mockCliRegistry(REPO, cli),
      mockWorkingTree(),
    );

    const status = await svc.getSyncStatus(REPO, false);
    assert.deepEqual(status, {
      ahead: 2,
      behind: 1,
      upstream: 'origin/main',
      busy: false,
    });
  });

  it('computes ahead/behind via rev-list when vscode.git omits counts', async () => {
    const { cli, reads } = mockGitCli({
      execRead: async () => ({ stdout: '3\t7\n' }),
    });
    const repo = mockRepository(REPO, {
      state: {
        HEAD: {
          name: 'main',
          upstream: { name: 'origin/main' },
        },
        onDidChange: () => ({ dispose: () => undefined }),
      },
    });
    const svc = new RemoteSyncService(
      mockGitExtensionService([repo]),
      mockCliRegistry(REPO, cli),
      mockWorkingTree(),
    );

    const status = await svc.getSyncStatus(REPO, true);
    assert.equal(status.ahead, 7);
    assert.equal(status.behind, 3);
    assert.equal(status.busy, true);
    assert.deepEqual(reads[0]?.slice(0, 3), ['rev-list', '--left-right', '--count']);
  });
});

describe('RemoteSyncService.fetch', () => {
  it('fetches every tag through the CLI when the setting is on', async () => {
    const { cli, writes } = mockGitCli();
    const svc = new RemoteSyncService(
      mockGitExtensionService([mockRepository(REPO, {})]),
      mockCliRegistry(REPO, cli),
      mockWorkingTree(),
      { ...defaultGitCheckoutSettings, fetchIncludeTags: () => true },
    );
    await svc.fetch(REPO);
    assert.deepEqual(writes, [['fetch', '--tags']]);
  });

  it('falls back to CLI when vscode.git fetch fails', async () => {
    const { cli, writes } = mockGitCli();
    const repo = mockRepository(REPO, {
      fetch: async () => {
        throw new Error('fetch failed');
      },
    });
    const svc = new RemoteSyncService(
      mockGitExtensionService([repo]),
      mockCliRegistry(REPO, cli),
      mockWorkingTree(),
    );

    await svc.fetch(REPO);
    assert.deepEqual(writes, [['fetch']]);
  });

  it('fetches the chosen remote through vscode.git', async () => {
    const { cli, writes } = mockGitCli();
    let fetched: { remote?: string } = {};
    const repo = mockRepository(REPO, {
      fetch: async (options) => {
        fetched = { remote: typeof options === 'string' ? options : options?.remote };
      },
    });
    const svc = new RemoteSyncService(
      mockGitExtensionService([repo]),
      mockCliRegistry(REPO, cli),
      mockWorkingTree(),
    );

    await svc.fetch(REPO, { remote: 'upstream' });
    assert.deepEqual(fetched, { remote: 'upstream' });
    assert.deepEqual(writes, []);
  });

  it('falls back to CLI for a chosen remote when vscode.git fetch fails', async () => {
    const { cli, writes } = mockGitCli();
    const repo = mockRepository(REPO, {
      fetch: async () => {
        throw new Error('fetch failed');
      },
    });
    const svc = new RemoteSyncService(
      mockGitExtensionService([repo]),
      mockCliRegistry(REPO, cli),
      mockWorkingTree(),
    );

    await svc.fetch(REPO, { remote: 'upstream' });
    assert.deepEqual(writes, [['fetch', '--', 'upstream']]);
  });

  it('fetches every remote via the CLI', async () => {
    const { cli, writes } = mockGitCli();
    const repo = mockRepository(REPO, {
      fetch: async () => {
        throw new Error('should not call api');
      },
    });
    const svc = new RemoteSyncService(
      mockGitExtensionService([repo]),
      mockCliRegistry(REPO, cli),
      mockWorkingTree(),
    );

    await svc.fetch(REPO, { remote: 'origin', all: true });
    assert.deepEqual(writes, [['fetch', '--all']]);
  });
});

describe('RemoteSyncService.pull', () => {
  it('uses vscode.git pull when no remote, branch, or rebase is requested', async () => {
    const { cli, writes } = mockGitCli();
    let pulled = false;
    const repo = mockRepository(REPO, {
      pull: async () => {
        pulled = true;
      },
    });
    const svc = new RemoteSyncService(
      mockGitExtensionService([repo]),
      mockCliRegistry(REPO, cli),
      mockWorkingTree(),
    );

    await svc.pull(REPO);
    assert.equal(pulled, true);
    assert.deepEqual(writes, []);
  });

  it('pulls the chosen remote branch via the CLI', async () => {
    const { cli, writes } = mockGitCli();
    const repo = mockRepository(REPO, {
      pull: async () => {
        throw new Error('should not call api');
      },
    });
    const svc = new RemoteSyncService(
      mockGitExtensionService([repo]),
      mockCliRegistry(REPO, cli),
      mockWorkingTree(),
    );

    await svc.pull(REPO, { remote: 'upstream', branch: 'feature/one', rebase: true, stash: false });
    assert.deepEqual(writes, [['pull', '--rebase', '--', 'upstream', 'feature/one']]);
  });

  it('stashes a dirty tree only when stash is requested', async () => {
    const { cli, writes } = mockGitCli();
    const repo = mockRepository(REPO);
    const svc = new RemoteSyncService(
      mockGitExtensionService([repo]),
      mockCliRegistry(REPO, cli),
      mockWorkingTree(false),
      settings({ leanBranchingStashOnSwitch: () => true }),
    );

    await svc.pull(REPO, { remote: 'origin', branch: 'main', rebase: false, stash: false });
    assert.deepEqual(writes, [['pull', '--no-rebase', '--', 'origin', 'main']]);

    writes.length = 0;
    await svc.pull(REPO, { remote: 'origin', branch: 'main', stash: true });
    assert.deepEqual(
      writes.map((args) => args[0]),
      ['stash', 'pull', 'stash'],
    );
  });

  it('stashes on a default pull when lean branching is enabled', async () => {
    const { cli, writes } = mockGitCli();
    const repo = mockRepository(REPO, {
      pull: async () => undefined,
    });
    const svc = new RemoteSyncService(
      mockGitExtensionService([repo]),
      mockCliRegistry(REPO, cli),
      mockWorkingTree(false),
      settings({ leanBranchingStashOnSwitch: () => true }),
    );

    await svc.pull(REPO);
    assert.deepEqual(
      writes.map((args) => args[0]),
      ['stash', 'stash'],
    );
  });
});

describe('RemoteSyncService.push', () => {
  it('uses vscode.git push when hooks and force are off', async () => {
    const { cli, writes } = mockGitCli();
    let pushed: { remote?: string; branch?: string } = {};
    const repo = mockRepository(REPO, {
      state: {
        HEAD: {
          name: 'main',
          upstream: { name: 'origin/main' },
        },
        onDidChange: () => ({ dispose: () => undefined }),
      },
      push: async (remote, branch) => {
        pushed = { remote, branch };
      },
    });
    const svc = new RemoteSyncService(
      mockGitExtensionService([repo]),
      mockCliRegistry(REPO, cli),
      mockWorkingTree(),
    );

    await svc.push(REPO);
    assert.deepEqual(pushed, { remote: 'origin', branch: 'main' });
    assert.equal(writes.length, 0);
  });

  it('pushes via CLI with --no-verify when skip hooks is enabled', async () => {
    const { cli, writes } = mockGitCli();
    const repo = mockRepository(REPO, {
      state: {
        HEAD: {
          name: 'main',
          upstream: { name: 'origin/main' },
        },
        onDidChange: () => ({ dispose: () => undefined }),
      },
      push: async () => {
        throw new Error('should not call api');
      },
    });
    const svc = new RemoteSyncService(
      mockGitExtensionService([repo]),
      mockCliRegistry(REPO, cli),
      mockWorkingTree(),
      settings({ gitSkipHooks: () => true }),
    );

    await svc.push(REPO);
    assert.deepEqual(writes, [['push', '--no-verify', '--', 'origin', 'main']]);
  });

  it('falls back to CLI when vscode.git push fails', async () => {
    const { cli, writes } = mockGitCli();
    const repo = mockRepository(REPO, {
      state: {
        HEAD: {
          name: 'main',
          upstream: { name: 'origin/main' },
        },
        onDidChange: () => ({ dispose: () => undefined }),
      },
      push: async () => {
        throw new Error('push failed');
      },
    });
    const svc = new RemoteSyncService(
      mockGitExtensionService([repo]),
      mockCliRegistry(REPO, cli),
      mockWorkingTree(),
    );

    await svc.push(REPO);
    assert.deepEqual(writes, [['push', '--', 'origin', 'main']]);
  });

  it('pushes the chosen remote and branch with tags and force-with-lease', async () => {
    const { cli, writes } = mockGitCli();
    const repo = mockRepository(REPO, {
      state: {
        HEAD: {
          name: 'feature',
          upstream: { name: 'origin/feature' },
        },
        onDidChange: () => ({ dispose: () => undefined }),
      },
      push: async () => {
        throw new Error('should not call api');
      },
    });
    const svc = new RemoteSyncService(
      mockGitExtensionService([repo]),
      mockCliRegistry(REPO, cli),
      mockWorkingTree(),
    );

    await svc.push(REPO, {
      remote: 'upstream',
      branch: 'main',
      tags: true,
      forceWithLease: true,
      setUpstream: true,
    });
    assert.deepEqual(writes, [
      ['push', '-u', '--force-with-lease', '--tags', '--', 'upstream', 'main'],
    ]);
  });

  it('uses vscode.git for an explicit remote and branch when tags and force are off', async () => {
    const { cli, writes } = mockGitCli();
    let pushed: { remote?: string; branch?: string; setUpstream?: boolean } = {};
    const repo = mockRepository(REPO, {
      state: {
        HEAD: { name: 'feature' },
        onDidChange: () => ({ dispose: () => undefined }),
      },
      push: async (remote, branch, setUpstream) => {
        pushed = { remote, branch, setUpstream };
      },
    });
    const svc = new RemoteSyncService(
      mockGitExtensionService([repo]),
      mockCliRegistry(REPO, cli),
      mockWorkingTree(),
    );

    await svc.push(REPO, { remote: 'origin', branch: 'feature', setUpstream: true });
    assert.deepEqual(pushed, { remote: 'origin', branch: 'feature', setUpstream: true });
    assert.equal(writes.length, 0);
  });
});

describe('RemoteSyncService.unsetUpstream', () => {
  it('calls git branch --unset-upstream for the given branch', async () => {
    const { cli, writes } = mockGitCli();
    const repo = mockRepository(REPO);
    const svc = new RemoteSyncService(
      mockGitExtensionService([repo]),
      mockCliRegistry(REPO, cli),
      mockWorkingTree(),
    );

    await svc.unsetUpstream(REPO, 'feature');
    assert.deepEqual(writes, [['branch', '--unset-upstream', 'feature']]);
  });
});

describe('RemoteSyncService.fastForward', () => {
  it('runs git merge --ff-only @{u} when branch is HEAD', async () => {
    const { cli, writes } = mockGitCli();
    const repo = mockRepository(REPO, {
      state: {
        HEAD: { name: 'main' },
        onDidChange: () => ({ dispose: () => undefined }),
      },
    });
    const svc = new RemoteSyncService(
      mockGitExtensionService([repo]),
      mockCliRegistry(REPO, cli),
      mockWorkingTree(),
    );

    await svc.fastForward(REPO, 'main');
    assert.deepEqual(writes, [['merge', '--ff-only', '@{u}']]);
  });

  it('runs git fetch . upstream:branch when branch is not HEAD', async () => {
    const { cli, writes } = mockGitCli({
      execRead: async (args) => {
        if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') {
          return { stdout: 'origin/feature\n' };
        }
        return { stdout: '' };
      },
    });
    const repo = mockRepository(REPO, {
      state: {
        HEAD: { name: 'main' },
        onDidChange: () => ({ dispose: () => undefined }),
      },
    });
    const svc = new RemoteSyncService(
      mockGitExtensionService([repo]),
      mockCliRegistry(REPO, cli),
      mockWorkingTree(),
    );

    await svc.fastForward(REPO, 'feature');
    assert.deepEqual(writes, [['fetch', '.', 'origin/feature:feature']]);
  });
});

