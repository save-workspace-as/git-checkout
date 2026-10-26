import { strict as assert } from 'node:assert';
import { afterEach, describe, it } from 'node:test';

import { GitCliError } from './gitCliError';
import { WINDOWS_GIT_PATH_REJECTED } from './gitPath';
import { GitCliRegistry } from './gitCliRegistry';
import type { GitExtensionService } from './gitExtensionService';
import {
  getGitExtensionService,
  setGitExtensionService,
} from './gitExtensionServiceState';

const REPO = '/repo';

function mockReadyExtensionService(gitPath = 'git'): GitExtensionService {
  return {
    getDiagnostics: () => ({
      bindingState: 'ready',
      remoteName: null,
      extensionKind: 'workspace',
      gitExtensionEnabled: true,
      gitPath,
      repositories: [],
    }),
    getGitPath: () => gitPath,
    getRepositories: () => [],
  } as unknown as GitExtensionService;
}

afterEach(() => {
  setGitExtensionService(undefined);
});

describe('GitCliRegistry', () => {
  it('throws NotReady when vscode.git is not bound', () => {
    setGitExtensionService({
      getDiagnostics: () => ({
        bindingState: 'git_disabled',
        remoteName: null,
        extensionKind: 'workspace',
        gitExtensionEnabled: false,
        gitPath: null,
        repositories: [],
      }),
      getGitPath: () => null,
      getRepositories: () => [],
    } as unknown as GitExtensionService);

    const registry = new GitCliRegistry();
    assert.throws(
      () => registry.getOrCreate(REPO),
      (error: unknown) => error instanceof GitCliError && error.code === 'NotReady',
    );
  });

  it('reuses GitCli instances per repository root', () => {
    setGitExtensionService(mockReadyExtensionService());
    const registry = new GitCliRegistry();
    const first = registry.getOrCreate(REPO);
    const second = registry.getOrCreate(REPO);
    assert.equal(first, second);
  });

  it('drops cached clients when repositories close', () => {
    setGitExtensionService(mockReadyExtensionService());
    const registry = new GitCliRegistry();
    const first = registry.getOrCreate(REPO);
    registry.syncOpenRepositories([]);
    const second = registry.getOrCreate(REPO);
    assert.notEqual(first, second);
  });

  it('reports a rejected Windows git.path instead of spawning it', () => {
    setGitExtensionService({
      getDiagnostics: () => ({
        bindingState: 'ready',
        remoteName: 'wsl',
        extensionKind: 'workspace',
        gitExtensionEnabled: true,
        gitPath: null,
        gitPathWarning: WINDOWS_GIT_PATH_REJECTED,
        repositories: [],
      }),
      getGitPath: () => null,
      getRepositories: () => [],
    } as unknown as GitExtensionService);

    const registry = new GitCliRegistry();
    assert.throws(
      () => registry.getOrCreate(REPO),
      (error: unknown) =>
        error instanceof GitCliError &&
        error.code === 'NotReady' &&
        error.message === WINDOWS_GIT_PATH_REJECTED,
    );
  });

  it('requires extension service to be registered', () => {
    setGitExtensionService(undefined);
    const registry = new GitCliRegistry();
    assert.throws(() => registry.getOrCreate(REPO));
    assert.equal(getGitExtensionService(), undefined);
  });
});
