import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { CheckoutService } from './checkoutService';
import { defaultGitCheckoutSettings } from '../../core/gitCheckoutSettings';
import {
    mockCliRegistry,
    mockGitCli,
    mockGitExtensionService,
    mockRepository,
    mockWorkingTree,
} from '../../core/testing/serviceTestUtils';

const REPO = '/repo';

describe('CheckoutService.detectFastForward', () => {
  it('returns null for a non-remote ref', async () => {
    const { cli } = mockGitCli();
    const svc = new CheckoutService(
      mockGitExtensionService([mockRepository(REPO)]),
      mockCliRegistry(REPO, cli),
      mockWorkingTree(),
    );
    assert.equal(await svc.detectFastForward(REPO, 'main'), null);
  });

  it('returns null when the local branch is missing', async () => {
    const { cli } = mockGitCli({
      execRead: async () => {
        throw new Error('missing ref');
      },
    });
    const svc = new CheckoutService(
      mockGitExtensionService([mockRepository(REPO)]),
      mockCliRegistry(REPO, cli),
      mockWorkingTree(),
    );
    assert.equal(await svc.detectFastForward(REPO, 'origin/feature'), null);
  });

  it('returns an offer when local is behind the remote tracking ref', async () => {
    const { cli } = mockGitCli({
      execRead: async (args) => {
        if (args[0] === 'rev-parse' && args[1] === 'feature') {
          return { stdout: 'local-sha\n' };
        }
        if (args[0] === 'rev-parse' && args[1] === 'origin/feature') {
          return { stdout: 'remote-sha\n' };
        }
        return { stdout: '' };
      },
    });
    const svc = new CheckoutService(
      mockGitExtensionService([mockRepository(REPO)]),
      mockCliRegistry(REPO, cli),
      mockWorkingTree(),
    );
    assert.deepEqual(await svc.detectFastForward(REPO, 'origin/feature'), {
      localBranch: 'feature',
      remoteRef: 'origin/feature',
    });
  });

  it('returns null when local and remote are the same commit', async () => {
    const { cli } = mockGitCli({
      execRead: async () => ({ stdout: 'same-sha\n' }),
    });
    const svc = new CheckoutService(
      mockGitExtensionService([mockRepository(REPO)]),
      mockCliRegistry(REPO, cli),
      mockWorkingTree(),
    );
    assert.equal(await svc.detectFastForward(REPO, 'origin/feature'), null);
  });
});

describe('CheckoutService.checkout', () => {
  it('checks out an existing local branch for a remote-style ref', async () => {
    const { cli, writes } = mockGitCli();
    const repo = mockRepository(REPO);
    const svc = new CheckoutService(
      mockGitExtensionService([repo]),
      mockCliRegistry(REPO, cli),
      mockWorkingTree(),
    );

    const filterRef = await svc.checkout(REPO, 'origin/feature');
    assert.equal(filterRef, 'feature');
    assert.deepEqual(writes, [['checkout', 'feature']]);
  });

  it('creates a tracking branch when the local branch is missing', async () => {
    const { cli, writes } = mockGitCli({
      execRead: async (args) => {
        if (args[0] === 'show-ref') {
          throw new Error('not found');
        }
        return { stdout: '' };
      },
    });
    const svc = new CheckoutService(
      mockGitExtensionService([mockRepository(REPO)]),
      mockCliRegistry(REPO, cli),
      mockWorkingTree(),
    );

    const filterRef = await svc.checkout(REPO, 'origin/feature');
    assert.equal(filterRef, 'feature');
    assert.deepEqual(writes, [['switch', '-c', 'feature', '--track', 'origin/feature']]);
  });

  it('fast-forwards when requested and an offer exists', async () => {
    const { cli, writes } = mockGitCli({
      execRead: async (args) => {
        if (args[0] === 'rev-parse' && args[1] === 'feature') {
          return { stdout: 'local-sha\n' };
        }
        if (args[0] === 'rev-parse' && args[1] === 'origin/feature') {
          return { stdout: 'remote-sha\n' };
        }
        return { stdout: '' };
      },
    });
    const svc = new CheckoutService(
      mockGitExtensionService([mockRepository(REPO)]),
      mockCliRegistry(REPO, cli),
      mockWorkingTree(),
      defaultGitCheckoutSettings,
    );

    const filterRef = await svc.checkout(REPO, 'origin/feature', { fastForward: true });
    assert.equal(filterRef, 'feature');
    assert.deepEqual(writes, [
      ['checkout', 'feature'],
      ['merge', '--ff-only', 'origin/feature'],
    ]);
  });

  it('falls back to CLI when vscode.git checkout fails', async () => {
    const { cli, writes } = mockGitCli({
      execWrite: async (args) => {
        if (args[0] === 'switch') {
          throw new Error('switch failed');
        }
      },
    });
    const repo = mockRepository(REPO, {
      checkout: async () => {
        throw new Error('api failed');
      },
    });
    const svc = new CheckoutService(
      mockGitExtensionService([repo]),
      mockCliRegistry(REPO, cli),
      mockWorkingTree(),
    );

    const filterRef = await svc.checkout(REPO, 'main');
    assert.equal(filterRef, 'main');
    assert.deepEqual(writes, [['switch', 'main'], ['checkout', 'main']]);
  });

  it('checks out a slash-named local branch as itself when localBranch is set', async () => {
    const { cli, writes } = mockGitCli();
    const checkouts: string[] = [];
    const repo = mockRepository(REPO, {
      checkout: async (ref: string) => {
        checkouts.push(ref);
      },
    });
    const svc = new CheckoutService(
      mockGitExtensionService([repo]),
      mockCliRegistry(REPO, cli),
      mockWorkingTree(),
    );

    const filterRef = await svc.checkout(REPO, 'agent/feature', { localBranch: true });
    assert.equal(filterRef, 'agent/feature');
    assert.deepEqual(checkouts, ['agent/feature']);
    assert.deepEqual(writes, []);
  });

  it('detaches HEAD at a reflog commit', async () => {
    const { cli, writes } = mockGitCli();
    const checkouts: string[] = [];
    const repo = mockRepository(REPO, {
      checkout: async (ref: string) => {
        checkouts.push(ref);
      },
    });
    const svc = new CheckoutService(
      mockGitExtensionService([repo]),
      mockCliRegistry(REPO, cli),
      mockWorkingTree(),
    );

    const filterRef = await svc.checkout(REPO, 'abc123', { detach: true });
    assert.equal(filterRef, 'abc123');
    assert.deepEqual(checkouts, []);
    assert.deepEqual(writes, [['checkout', '--detach', 'abc123']]);
  });
});
