import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { CommitService } from './commitService';
import type { GitCheckoutSettingsReader } from '../../core/gitCheckoutSettings';
import { defaultGitCheckoutSettings } from '../../core/gitCheckoutSettings';
import {
  mockCliRegistry,
  mockGitCli,
  mockGitExtensionService,
  mockRepository,
} from '../../core/testing/serviceTestUtils';

const REPO = '/repo';

function settings(overrides: Partial<GitCheckoutSettingsReader>): GitCheckoutSettingsReader {
  return { ...defaultGitCheckoutSettings, ...overrides };
}

describe('CommitService.commit', () => {
  it('uses vscode.git commit when hooks are enabled', async () => {
    const { cli, writes } = mockGitCli();
    let message: string | undefined;
    const repo = mockRepository(REPO, {
      commit: async (msg) => {
        message = msg;
      },
    });
    const svc = new CommitService(mockGitExtensionService([repo]), mockCliRegistry(REPO, cli));

    await svc.commit(REPO, 'hello', false);
    assert.equal(message, 'hello');
    assert.equal(writes.length, 0);
  });

  it('falls back to CLI when vscode.git commit fails', async () => {
    const { cli, writes } = mockGitCli();
    const repo = mockRepository(REPO, {
      commit: async () => {
        throw new Error('commit failed');
      },
    });
    const svc = new CommitService(mockGitExtensionService([repo]), mockCliRegistry(REPO, cli));

    await svc.commit(REPO, 'hello', false);
    assert.deepEqual(writes, [['commit', '-m', 'hello']]);
  });

  it('commits via CLI with --no-verify when skip hooks is enabled', async () => {
    const { cli, writes } = mockGitCli();
    let apiCalled = false;
    const repo = mockRepository(REPO, {
      commit: async () => {
        apiCalled = true;
      },
    });
    const svc = new CommitService(
      mockGitExtensionService([repo]),
      mockCliRegistry(REPO, cli),
      settings({ gitSkipHooks: () => true }),
    );

    await svc.commit(REPO, 'hello', false);
    assert.equal(apiCalled, false);
    assert.deepEqual(writes, [['commit', '-m', 'hello', '--no-verify']]);
  });

  it('amends via CLI even when hooks are disabled', async () => {
    const { cli, writes } = mockGitCli();
    let apiCalled = false;
    const repo = mockRepository(REPO, {
      commit: async () => {
        apiCalled = true;
      },
    });
    const svc = new CommitService(mockGitExtensionService([repo]), mockCliRegistry(REPO, cli));

    await svc.commit(REPO, 'amended', true);
    assert.equal(apiCalled, false);
    assert.deepEqual(writes, [['commit', '-m', 'amended', '--amend']]);
  });
});

describe('CommitService.getGpgsign', () => {
  it('returns true for common truthy config values', async () => {
    const { cli } = mockGitCli({
      execRead: async () => ({ stdout: 'true\n' }),
    });
    const svc = new CommitService(
      mockGitExtensionService([mockRepository(REPO)]),
      mockCliRegistry(REPO, cli),
    );
    assert.equal(await svc.getGpgsign(REPO), true);
  });

  it('returns false when config is missing', async () => {
    const { cli } = mockGitCli({
      execRead: async () => {
        throw new Error('missing');
      },
    });
    const svc = new CommitService(
      mockGitExtensionService([mockRepository(REPO)]),
      mockCliRegistry(REPO, cli),
    );
    assert.equal(await svc.getGpgsign(REPO), false);
  });
});

describe('CommitService tag signing', () => {
  it('reads tag.gpgSign and writes the matching config key', async () => {
    const { cli, writes } = mockGitCli({
      execRead: async (args) => {
        assert.deepEqual(args, ['config', '--get', 'tag.gpgSign']);
        return { stdout: 'yes\n' };
      },
    });
    const svc = new CommitService(
      mockGitExtensionService([mockRepository(REPO)]),
      mockCliRegistry(REPO, cli),
    );
    assert.equal(await svc.getTagGpgSign(REPO), true);
    await svc.setTagGpgSign(REPO, false);
    assert.deepEqual(writes, [['config', 'tag.gpgSign', 'false']]);
  });
});
