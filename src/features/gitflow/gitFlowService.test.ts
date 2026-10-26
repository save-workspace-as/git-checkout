import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { GitCliError } from '../../core/gitCliError';
import type { GitCli, GitExecOptions, GitExecResult } from '../../core/gitCli';
import { defaultGitCheckoutSettings } from '../../core/gitCheckoutSettings';
import { GitFlowService } from './gitFlowService';
import { mockCliRegistry } from '../../core/testing/serviceTestUtils';

const REPO = '/repo';

interface RecordedCall {
  args: string[];
  options?: GitExecOptions;
}

function recordingCli(
  handler: (args: string[], options?: GitExecOptions) => GitExecResult,
): { calls: RecordedCall[]; cli: GitCli } {
  const calls: RecordedCall[] = [];
  const run = async (args: string[], options?: GitExecOptions): Promise<GitExecResult> => {
    calls.push({ args, options });
    return handler(args, options);
  };
  const cli = {
    execRead: run,
    execWrite: run,
  } as unknown as GitCli;
  return { calls, cli };
}

function ok(stdout: string, stderr = ''): GitExecResult {
  return { stdout, stderr, exitCode: 0 };
}

describe('GitFlowService', () => {
  it('returns documented commands and does not run them when git-flow is missing', async () => {
    const { calls, cli } = recordingCli((args) => {
      if (args[0] === 'flow') {
        throw new GitCliError('ExitCode', "git: 'flow' is not a git command.", REPO, "git: 'flow' is not a git command.", 1);
      }
      if (args[0] === 'config') {
        throw new GitCliError('ExitCode', 'missing', REPO, '', 1);
      }
      return ok('main\n');
    });
    const result = await new GitFlowService(mockCliRegistry(REPO, cli)).run(REPO, {
      action: 'start',
      kind: 'feature',
      name: 'widget',
    });
    assert.equal(result.available, false);
    assert.equal(result.ran, false);
    assert.match(result.message, /not installed/);
    assert.deepEqual(result.commands, ['git checkout develop', 'git checkout -b feature/widget']);
    assert.deepEqual(
      calls.map((call) => call.args[0]),
      ['flow', 'config', 'for-each-ref'],
    );
  });

  it('uses gitflow config for the documented branch names', async () => {
    const { cli } = recordingCli((args) => {
      if (args[0] === 'flow') {
        throw new GitCliError('ExitCode', 'missing', REPO, 'not a git command', 1);
      }
      if (args[0] === 'config') {
        return ok('gitflow.branch.master trunk\ngitflow.prefix.hotfix hf/\n');
      }
      return ok('main\n');
    });
    const result = await new GitFlowService(mockCliRegistry(REPO, cli)).run(REPO, {
      action: 'start',
      kind: 'hotfix',
      name: '1.2.3',
    });
    assert.deepEqual(result.commands, ['git checkout trunk', 'git checkout -b hf/1.2.3']);
  });

  it('runs git flow publish with host env and the network timeout', async () => {
    const { calls, cli } = recordingCli((args) => {
      if (args[0] === 'flow' && args[1] === 'version') {
        return ok('1.12.3 (AVH Edition)\n');
      }
      return ok('');
    });
    const settings = { ...defaultGitCheckoutSettings, networkTimeoutMs: () => 45_000 };
    const result = await new GitFlowService(mockCliRegistry(REPO, cli), settings).run(REPO, {
      action: 'publish',
      kind: 'release',
      name: '1.2.3',
    });
    assert.equal(result.ran, true);
    assert.equal(result.version, '1.12.3 (AVH Edition)');
    assert.deepEqual(result.commands, ['git flow release publish 1.2.3']);
    const write = calls[1];
    assert.deepEqual(write?.args, ['flow', 'release', 'publish', '1.2.3']);
    assert.equal(write?.options?.network, true);
    assert.equal(write?.options?.timeoutMs, 45_000);
    assert.equal(write?.options?.env?.GIT_EDITOR, 'true');
    assert.equal(write?.options?.showErrorToast, false);
  });

  describe('init', () => {
    const config = {
      production: 'main',
      develop: 'develop',
      featurePrefix: 'feature/',
      releasePrefix: 'release/',
      hotfixPrefix: 'hotfix/',
      versionTagPrefix: '',
    };

    function repoWith(branches: string, flowConfig = '') {
      return recordingCli((args) => {
        if (args[0] === 'config' && args[1] === '--get-regexp') {
          if (!flowConfig) {
            throw new GitCliError('ExitCode', 'none', REPO, '', 1);
          }
          return ok(flowConfig);
        }
        if (args[0] === 'for-each-ref') {
          return ok(branches);
        }
        return ok('');
      });
    }

    it('reports whether git-flow is set up and the layout to start the form from', async () => {
      const fresh = await new GitFlowService(mockCliRegistry(REPO, repoWith('master\n').cli)).readInitState(REPO);
      assert.equal(fresh.initialized, false);
      assert.equal(fresh.defaults.production, 'master');
      assert.deepEqual(fresh.branchNames, ['master']);

      const set = await new GitFlowService(
        mockCliRegistry(REPO, repoWith('main\ndev\n', 'gitflow.branch.master main\ngitflow.branch.develop dev\n').cli),
      ).readInitState(REPO);
      assert.equal(set.initialized, true);
      assert.equal(set.defaults.develop, 'dev');
    });

    it('initializes without the git-flow command', async () => {
      const { calls, cli } = repoWith('main\n');
      const result = await new GitFlowService(mockCliRegistry(REPO, cli)).initialize(REPO, config);
      const writes = calls.filter((call) => call.args[0] !== 'for-each-ref').map((call) => call.args);
      assert.deepEqual(writes[0], ['branch', 'develop', 'main']);
      assert.deepEqual(writes.at(-1), ['checkout', 'develop']);
      assert.equal(writes.some((args) => args[0] === 'flow'), false);
      assert.equal(result.ran, true);
      assert.match(result.message, /main and develop/);
    });

    it('does not touch the repository when the layout is invalid', async () => {
      const { calls, cli } = repoWith('main\n');
      await assert.rejects(
        new GitFlowService(mockCliRegistry(REPO, cli)).initialize(REPO, { ...config, production: 'trunk' }),
        /does not exist/,
      );
      assert.equal(calls.some((call) => call.args[0] === 'branch' || call.args[0] === 'checkout'), false);
    });

    it('fills a command-argument init with the repository defaults', async () => {
      const { calls, cli } = repoWith('main\n');
      await new GitFlowService(mockCliRegistry(REPO, cli)).run(REPO, {
        action: 'init',
        init: { develop: 'dev' },
      });
      assert.ok(calls.some((call) => call.args.join(' ') === 'branch dev main'));
      assert.ok(calls.some((call) => call.args.join(' ') === 'config gitflow.prefix.feature feature/'));
    });
  });
});
