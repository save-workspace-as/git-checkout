import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { IntegrationService } from './integrationService';
import {
  mockCliRegistry,
  mockGitCli,
  mockGitExtensionService,
  mockRepository,
  mockWorkingTree,
} from '../../core/testing/serviceTestUtils';

const REPO = '/repo';

describe('IntegrationService', () => {
  it('merge uses vscode.git when available', async () => {
    const { cli, writes } = mockGitCli();
    let mergedRef: string | undefined;
    const repo = mockRepository(REPO, {
      merge: async (ref) => {
        mergedRef = ref;
      },
    });
    const svc = new IntegrationService(
      mockGitExtensionService([repo]),
      mockCliRegistry(REPO, cli),
      mockWorkingTree(),
    );

    await svc.merge(REPO, 'other');
    assert.equal(mergedRef, 'other');
    assert.equal(writes.some((args) => args[0] === 'merge'), false);
  });

  it('merge falls back to CLI when vscode.git merge fails', async () => {
    const { cli, writes } = mockGitCli();
    const repo = mockRepository(REPO, {
      merge: async () => {
        throw new Error('merge failed');
      },
    });
    const svc = new IntegrationService(
      mockGitExtensionService([repo]),
      mockCliRegistry(REPO, cli),
      mockWorkingTree(),
    );

    await svc.merge(REPO, 'other');
    assert.deepEqual(writes, [['merge', 'other']]);
  });

  it('passes the fast-forward merge mode to git CLI', async () => {
    const { cli, writes } = mockGitCli();
    const repo = mockRepository(REPO, { merge: async () => {} });
    const svc = new IntegrationService(
      mockGitExtensionService([repo]),
      mockCliRegistry(REPO, cli),
      mockWorkingTree(),
    );

    await svc.merge(REPO, 'other', { mergeMode: 'fastForward' });
    assert.deepEqual(writes, [['merge', '--ff', 'other']]);
  });

  it('rebase uses CLI when vscode.git rebase is unavailable', async () => {
    const { cli, writes } = mockGitCli();
    const repo = mockRepository(REPO);
    const svc = new IntegrationService(
      mockGitExtensionService([repo]),
      mockCliRegistry(REPO, cli),
      mockWorkingTree(),
    );

    await svc.rebase(REPO, 'main');
    assert.deepEqual(writes, [['rebase', 'main']]);
  });

  it('rebase falls back to CLI when vscode.git rebase fails', async () => {
    const { cli, writes } = mockGitCli();
    const repo = mockRepository(REPO, {
      rebase: async () => {
        throw new Error('rebase failed');
      },
    });
    const svc = new IntegrationService(
      mockGitExtensionService([repo]),
      mockCliRegistry(REPO, cli),
      mockWorkingTree(),
    );

    await svc.rebase(REPO, 'main');
    assert.deepEqual(writes, [['rebase', 'main']]);
  });

  it('updates dependent branch refs through git rebase --update-refs', async () => {
    const { cli, writes } = mockGitCli();
    const repo = mockRepository(REPO, { rebase: async () => {} });
    const svc = new IntegrationService(
      mockGitExtensionService([repo]),
      mockCliRegistry(REPO, cli),
      mockWorkingTree(),
    );

    await svc.rebase(REPO, 'main', { updateRefs: true, stashDirty: false });
    assert.deepEqual(writes, [['rebase', '--update-refs', 'main']]);
  });
});
