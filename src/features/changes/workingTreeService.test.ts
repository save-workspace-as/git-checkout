import { strict as assert } from 'node:assert';
import * as path from 'node:path';
import { describe, it } from 'node:test';

import {
    mockCliRegistry,
    mockGitCli,
    mockGitExtensionService,
    mockRepository,
} from '../../core/testing/serviceTestUtils';
import { GitChangeStatus, type GitChange } from '../../core/vscodeGitApi';
import { MAX_PATHS_PER_COMMAND, WorkingTreeService, parsePorcelainStatus } from './workingTreeService';

const REPO = '/repo';

describe('parsePorcelainStatus', () => {
  it('returns clean for empty output', () => {
    assert.deepEqual(parsePorcelainStatus(''), {
      dirty: false,
      stagedCount: 0,
      unstagedCount: 0,
    });
  });

  it('counts untracked files', () => {
    const status = parsePorcelainStatus('?? new-file.ts\n');
    assert.equal(status.dirty, true);
    assert.equal(status.stagedCount, 0);
    assert.equal(status.unstagedCount, 1);
  });

  it('counts staged and unstaged changes separately', () => {
    const output = ['M  staged-only.ts', ' M unstaged-only.ts', 'MM both.ts'].join('\n');
    const status = parsePorcelainStatus(output);
    assert.equal(status.dirty, true);
    assert.equal(status.stagedCount, 2);
    assert.equal(status.unstagedCount, 2);
  });

  it('ignores blank lines', () => {
    const status = parsePorcelainStatus('\n\n');
    assert.equal(status.dirty, false);
  });
});

function fileChange(rel: string, status: GitChangeStatus): GitChange {
  return {
    uri: { fsPath: path.join(REPO, rel) },
    originalUri: { fsPath: path.join(REPO, rel) },
    status,
  } as GitChange;
}

describe('WorkingTreeService working copy', () => {
  it('builds a snapshot from repository.state and ls-files flags', async () => {
    const { cli } = mockGitCli({
      execRead: async (args) => {
        if (args[0] === 'ls-files') {
          return { stdout: 'h secret.ts\0' };
        }
        return { stdout: '' };
      },
    });
    const repo = mockRepository(REPO, {
      state: {
        HEAD: { name: 'main' },
        onDidChange: () => ({ dispose: () => undefined }),
        indexChanges: [fileChange('staged.ts', GitChangeStatus.INDEX_ADDED)],
        workingTreeChanges: [],
        untrackedChanges: [fileChange('new.ts', GitChangeStatus.UNTRACKED)],
      },
    });
    const svc = new WorkingTreeService(mockGitExtensionService([repo]), mockCliRegistry(REPO, cli));
    const snapshot = await svc.loadSnapshot(REPO);
    assert.deepEqual(
      snapshot.entries.map((entry) => `${entry.group}:${entry.path}`),
      ['staged:staged.ts', 'untracked:new.ts'],
    );
    assert.deepEqual(snapshot.flags, [
      { path: 'secret.ts', assumeUnchanged: true, skipWorktree: false },
    ]);
    assert.equal(snapshot.entries.every((entry) => !entry.submodule), true);
  });

  it('marks gitlink paths as submodules', async () => {
    const { cli } = mockGitCli({
      execRead: async (args) => {
        if (args[1] === '--stage') {
          return { stdout: '160000 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 0\tlibs/mid\0' };
        }
        return { stdout: '' };
      },
    });
    const repo = mockRepository(REPO, {
      state: {
        HEAD: { name: 'main' },
        onDidChange: () => ({ dispose: () => undefined }),
        workingTreeChanges: [fileChange('libs/mid', GitChangeStatus.MODIFIED)],
      },
    });
    const svc = new WorkingTreeService(mockGitExtensionService([repo]), mockCliRegistry(REPO, cli));
    const snapshot = await svc.loadSnapshot(REPO);
    assert.equal(snapshot.entries[0]?.submodule, true);
  });

  it('omits flags when ls-files fails', async () => {
    const { cli } = mockGitCli({
      execRead: async () => {
        throw new Error('ls-files failed');
      },
    });
    const repo = mockRepository(REPO, {
      state: {
        HEAD: { name: 'main' },
        onDidChange: () => ({ dispose: () => undefined }),
        workingTreeChanges: [fileChange('dirty.ts', GitChangeStatus.MODIFIED)],
      },
    });
    const svc = new WorkingTreeService(mockGitExtensionService([repo]), mockCliRegistry(REPO, cli));
    const snapshot = await svc.loadSnapshot(REPO);
    assert.equal(snapshot.entries.length, 1);
    assert.deepEqual(snapshot.flags, []);
  });

  it('stages, unstages, and discards through vscode.git', async () => {
    const calls: string[] = [];
    const repo = mockRepository(REPO, {
      state: {
        HEAD: { name: 'main' },
        onDidChange: () => ({ dispose: () => undefined }),
        indexChanges: [fileChange('staged.ts', GitChangeStatus.INDEX_MODIFIED)],
        workingTreeChanges: [],
        untrackedChanges: [],
      },
      add: async (paths) => {
        calls.push(`add ${paths.join(',')}`);
      },
      revert: async (paths) => {
        calls.push(`revert ${paths.join(',')}`);
      },
      clean: async (paths) => {
        calls.push(`clean ${paths.join(',')}`);
      },
    });
    const { cli } = mockGitCli();
    const svc = new WorkingTreeService(mockGitExtensionService([repo]), mockCliRegistry(REPO, cli));
    const stagedPath = path.join(REPO, 'staged.ts');
    const freshPath = path.join(REPO, 'new.ts');

    await svc.stageFile(REPO, 'new.ts');
    await svc.unstageFile(REPO, 'staged.ts');
    await svc.discardFile(REPO, 'staged.ts');
    await svc.discardFile(REPO, 'new.ts');

    assert.deepEqual(calls, [
      `add ${freshPath}`,
      `revert ${stagedPath}`,
      `revert ${stagedPath}`,
      `clean ${stagedPath}`,
      `clean ${freshPath}`,
    ]);
  });

  it('rejects a path outside the repository before calling git', async () => {
    const calls: string[] = [];
    const repo = mockRepository(REPO, {
      add: async () => {
        calls.push('add');
      },
    });
    const { cli } = mockGitCli();
    const svc = new WorkingTreeService(mockGitExtensionService([repo]), mockCliRegistry(REPO, cli));
    await assert.rejects(() => svc.stageFile(REPO, '../outside'), /Invalid working-copy path/);
    assert.deepEqual(calls, []);
  });

  describe('with several files', () => {
    function recordingService(stagedPaths: string[] = []) {
      const calls: string[] = [];
      const repo = mockRepository(REPO, {
        state: {
          HEAD: { name: 'main' },
          onDidChange: () => ({ dispose: () => undefined }),
          indexChanges: stagedPaths.map((name) => fileChange(name, GitChangeStatus.INDEX_MODIFIED)),
          workingTreeChanges: [],
          untrackedChanges: [],
        },
        add: async (paths) => { calls.push(`add ${paths.length}`); },
        revert: async (paths) => { calls.push(`revert ${paths.length}`); },
        clean: async (paths) => { calls.push(`clean ${paths.length}`); },
      });
      const { cli } = mockGitCli();
      return { calls, svc: new WorkingTreeService(mockGitExtensionService([repo]), mockCliRegistry(REPO, cli)) };
    }
    const stage = (names: string[]) => names.map((name) => ({ op: 'stage' as const, path: name }));

    it('stages and unstages them in one git command, not one each', async () => {
      const { calls, svc } = recordingService();
      await svc.runActions(REPO, stage(['a.ts', 'b.ts', 'c.ts']));
      await svc.runActions(REPO, ['a.ts', 'b.ts'].map((name) => ({ op: 'unstage' as const, path: name })));
      assert.deepEqual(calls, ['add 3', 'revert 2']);
    });

    it('discards them together, unstaging only the ones that are staged', async () => {
      const { calls, svc } = recordingService(['staged.ts']);
      await svc.runActions(REPO, ['staged.ts', 'plain.ts', 'new.ts'].map((name) => ({ op: 'discard' as const, path: name })));
      assert.deepEqual(calls, ['revert 1', 'clean 3']);
    });

    it('keeps the order of different kinds of action, merging only neighbors of one kind', async () => {
      const { calls, svc } = recordingService();
      await svc.runActions(REPO, [
        { op: 'stage', path: 'a.ts' }, { op: 'stage', path: 'b.ts' },
        { op: 'unstage', path: 'c.ts' },
        { op: 'stage', path: 'd.ts' },
      ]);
      assert.deepEqual(calls, ['add 2', 'revert 1', 'add 1']);
    });

    it('splits a very large selection so no command line gets too long', async () => {
      const { calls, svc } = recordingService();
      const names = Array.from({ length: MAX_PATHS_PER_COMMAND * 2 + 50 }, (_, i) => `f${i}.ts`);
      await svc.runActions(REPO, stage(names));
      assert.deepEqual(calls, [`add ${MAX_PATHS_PER_COMMAND}`, `add ${MAX_PATHS_PER_COMMAND}`, 'add 50']);
    });

    it('rejects the whole batch before running anything when one path is outside the repository', async () => {
      const { calls, svc } = recordingService();
      await assert.rejects(() => svc.runActions(REPO, stage(['ok.ts', '../outside'])), /Invalid working-copy path/);
      assert.deepEqual(calls, []);
    });

    it('does nothing for an empty list', async () => {
      const { calls, svc } = recordingService();
      await svc.runActions(REPO, []);
      assert.deepEqual(calls, []);
    });
  });
});
