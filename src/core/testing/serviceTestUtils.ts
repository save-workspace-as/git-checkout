import type { ExtensionContext } from 'vscode';
import type { GitCli } from '../gitCli';
import type { GitCliRegistry } from '../gitCliRegistry';
import type { GitExtensionService } from '../gitExtensionService';
import type { Repository } from '../vscodeGitApi';
import type { WorkingTreeService } from '../../features/changes/workingTreeService';

export function mockRepository(
  repoRoot: string,
  partial: Partial<Repository> = {},
): Repository {
  return {
    rootUri: { fsPath: repoRoot },
    state: {
      HEAD: { name: 'main' },
      onDidChange: () => ({ dispose: () => undefined }),
    },
    fetch: async () => undefined,
    pull: async () => undefined,
    push: async () => undefined,
    checkout: async () => undefined,
    commit: async () => undefined,
    ...partial,
  } as unknown as Repository;
}

export function mockGitExtensionService(
  repositories: Repository[],
  diagnostics?: { headName: string | null },
): GitExtensionService {
  return {
    getRepositories: () => repositories,
    getDiagnostics: () => ({
      bindingState: 'ready',
      remoteName: null,
      extensionKind: 'workspace',
      gitExtensionEnabled: true,
      gitPath: '/usr/bin/git',
      repositories: diagnostics
        ? [{ rootPath: repositories[0]?.rootUri.fsPath ?? '', headName: diagnostics.headName }]
        : [],
    }),
  } as unknown as GitExtensionService;
}

export function mockExtensionContext(initial: Record<string, unknown> = {}): ExtensionContext {
  const store = new Map<string, unknown>(Object.entries(initial));
  return {
    workspaceState: {
      get: <T>(key: string, defaultValue: T) => {
        if (store.has(key)) {
          return store.get(key) as T;
        }
        return defaultValue;
      },
      update: async (key: string, value: unknown) => {
        store.set(key, value);
      },
    },
  } as unknown as ExtensionContext;
}

export function mockWorkingTree(clean = true): WorkingTreeService {
  return {
    getStatus: async () => ({
      dirty: !clean,
      stagedCount: clean ? 0 : 1,
      unstagedCount: 0,
    }),
    hasStagedChanges: async () => !clean,
  } as unknown as WorkingTreeService;
}

export interface MockCliRecorder {
  reads: string[][];
  writes: string[][];
  cli: GitCli;
}

export function mockGitCli(handler?: {
  execRead?: (args: string[]) => Promise<{ stdout: string }>;
  execWrite?: (args: string[]) => Promise<void>;
}): MockCliRecorder {
  const reads: string[][] = [];
  const writes: string[][] = [];
  const cli = {
    execRead: async (args: string[]) => {
      reads.push(args);
      if (handler?.execRead) {
        return handler.execRead(args);
      }
      return { stdout: '' };
    },
    execWrite: async (args: string[]) => {
      writes.push(args);
      if (handler?.execWrite) {
        await handler.execWrite(args);
      }
    },
  } as unknown as GitCli;
  return { reads, writes, cli };
}

export function mockCliRegistry(repoRoot: string, cli: GitCli): GitCliRegistry {
  return {
    getOrCreate: (root: string) => {
      if (root !== repoRoot) {
        throw new Error(`unexpected repo root: ${root}`);
      }
      return cli;
    },
    forRepository: (repo: Repository) => {
      if (repo.rootUri.fsPath !== repoRoot) {
        throw new Error(`unexpected repo: ${repo.rootUri.fsPath}`);
      }
      return cli;
    },
    runWrite: async (_root: string, fn: () => Promise<void>) => fn(),
  } as unknown as GitCliRegistry;
}
