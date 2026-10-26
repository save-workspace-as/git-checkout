import { strict as assert } from 'node:assert';
import { mkdirSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { describe, it } from 'node:test';

import { initTempRepository, runGit } from '../../core/testing/gitRepoHarness';
import { mockCliRegistry, mockGitExtensionService, mockRepository } from '../../core/testing/serviceTestUtils';
import { WorkingTreeService } from './workingTreeService';

describe('WorkingTreeService integration', () => {
  it('toggles assume-unchanged and skip-worktree with update-index', async () => {
    const temp = initTempRepository();
    try {
      writeFileSync(path.join(temp.repoRoot, 'a.txt'), 'a\n');
      writeFileSync(path.join(temp.repoRoot, 'b.txt'), 'b\n');
      writeFileSync(path.join(temp.repoRoot, 'c.txt'), 'c\n');
      runGit(temp.repoRoot, ['add', 'a.txt', 'b.txt', 'c.txt']);
      runGit(temp.repoRoot, ['commit', '-m', 'init']);

      const repo = mockRepository(temp.repoRoot, {
        state: {
          HEAD: { name: 'main' },
          onDidChange: () => ({ dispose: () => undefined }),
          indexChanges: [],
          workingTreeChanges: [],
          untrackedChanges: [],
        },
      });
      const svc = new WorkingTreeService(
        mockGitExtensionService([repo]),
        mockCliRegistry(temp.repoRoot, temp.cli),
      );

      await svc.setAssumeUnchanged(temp.repoRoot, 'a.txt', true);
      await svc.setSkipWorktree(temp.repoRoot, 'b.txt', true);
      await svc.runAction(temp.repoRoot, { op: 'assumeUnchanged', path: 'c.txt', enabled: true });
      await svc.runAction(temp.repoRoot, { op: 'skipWorktree', path: 'c.txt', enabled: true });

      const snapshot = await svc.loadSnapshot(temp.repoRoot);
      const byPath = new Map(snapshot.flags.map((flag) => [flag.path, flag]));
      assert.equal(byPath.get('a.txt')?.assumeUnchanged, true);
      assert.equal(byPath.get('a.txt')?.skipWorktree, false);
      assert.equal(byPath.get('b.txt')?.skipWorktree, true);
      assert.equal(byPath.get('b.txt')?.assumeUnchanged, false);
      assert.equal(byPath.get('c.txt')?.assumeUnchanged, true);
      assert.equal(byPath.get('c.txt')?.skipWorktree, true);

      await svc.setAssumeUnchanged(temp.repoRoot, 'a.txt', false);
      const cleared = await svc.loadSnapshot(temp.repoRoot);
      assert.equal(cleared.flags.some((flag) => flag.path === 'a.txt'), false);
    } finally {
      temp.cleanup();
    }
  });

  it('stages and unstages a file in the index', async () => {
    const temp = initTempRepository();
    try {
      writeFileSync(path.join(temp.repoRoot, 'keep.txt'), 'keep\n');
      runGit(temp.repoRoot, ['add', 'keep.txt']);
      runGit(temp.repoRoot, ['commit', '-m', 'init']);
      writeFileSync(path.join(temp.repoRoot, 'keep.txt'), 'changed\n');
      writeFileSync(path.join(temp.repoRoot, 'new.txt'), 'new\n');

      const repo = mockRepository(temp.repoRoot, {
        add: async (paths: string[]) => {
          runGit(temp.repoRoot, ['add', '--', ...paths]);
        },
        revert: async (paths: string[]) => {
          runGit(temp.repoRoot, ['restore', '--staged', '--', ...paths]);
        },
      });
      const svc = new WorkingTreeService(
        mockGitExtensionService([repo]),
        mockCliRegistry(temp.repoRoot, temp.cli),
      );

      const before = await svc.listChanges(temp.repoRoot);
      assert.deepEqual(
        before.map((entry) => `${entry.group}:${entry.path}`),
        ['unstaged:keep.txt', 'untracked:new.txt'],
      );

      await svc.runAction(temp.repoRoot, { op: 'stage', path: 'new.txt' });
      await svc.runAction(temp.repoRoot, { op: 'stage', path: 'keep.txt' });
      const staged = await svc.listChanges(temp.repoRoot);
      assert.deepEqual(
        staged.map((entry) => `${entry.group}:${entry.path}:${entry.status}`),
        ['staged:keep.txt:modified', 'staged:new.txt:added'],
      );

      await svc.runAction(temp.repoRoot, { op: 'unstage', path: 'new.txt' });
      const unstaged = await svc.listChanges(temp.repoRoot);
      assert.equal(
        unstaged.find((entry) => entry.path === 'new.txt')?.group,
        'untracked',
      );
      assert.equal(
        unstaged.find((entry) => entry.path === 'keep.txt')?.group,
        'staged',
      );
    } finally {
      temp.cleanup();
    }
  });

  it('stages and unstages several files with one command each', async () => {
    const temp = initTempRepository();
    try {
      writeFileSync(path.join(temp.repoRoot, 'keep.txt'), 'keep\n');
      runGit(temp.repoRoot, ['add', 'keep.txt']);
      runGit(temp.repoRoot, ['commit', '-m', 'init']);
      writeFileSync(path.join(temp.repoRoot, 'keep.txt'), 'changed\n');
      for (const name of ['a.txt', 'b.txt', 'c.txt']) {
        writeFileSync(path.join(temp.repoRoot, name), `${name}\n`);
      }
      const gitCommands: string[][] = [];
      const repo = mockRepository(temp.repoRoot, {
        add: async (paths: string[]) => {
          gitCommands.push(['add', ...paths]);
          runGit(temp.repoRoot, ['add', '--', ...paths]);
        },
        revert: async (paths: string[]) => {
          gitCommands.push(['restore', ...paths]);
          runGit(temp.repoRoot, ['restore', '--staged', '--', ...paths]);
        },
      });
      const svc = new WorkingTreeService(mockGitExtensionService([repo]), mockCliRegistry(temp.repoRoot, temp.cli));
      const names = ['keep.txt', 'a.txt', 'b.txt', 'c.txt'];

      await svc.runActions(temp.repoRoot, names.map((name) => ({ op: 'stage' as const, path: name })));
      assert.deepEqual(
        (await svc.listChanges(temp.repoRoot)).map((entry) => `${entry.group}:${entry.path}`),
        ['staged:a.txt', 'staged:b.txt', 'staged:c.txt', 'staged:keep.txt'],
      );
      await svc.runActions(temp.repoRoot, names.map((name) => ({ op: 'unstage' as const, path: name })));
      assert.deepEqual(
        (await svc.listChanges(temp.repoRoot)).map((entry) => `${entry.group}:${entry.path}`),
        ['unstaged:keep.txt', 'untracked:a.txt', 'untracked:b.txt', 'untracked:c.txt'],
      );
      assert.equal(gitCommands.length, 2, 'one command to stage and one to unstage');
    } finally {
      temp.cleanup();
    }
  });

  it('lists ignored files and folders', async () => {
    const temp = initTempRepository();
    try {
      writeFileSync(path.join(temp.repoRoot, '.gitignore'), 'dist/\n*.log\n');
      runGit(temp.repoRoot, ['add', '.gitignore']);
      runGit(temp.repoRoot, ['commit', '-m', 'ignore']);
      mkdirSync(path.join(temp.repoRoot, 'dist'));
      writeFileSync(path.join(temp.repoRoot, 'dist', 'out.js'), 'x\n');
      writeFileSync(path.join(temp.repoRoot, 'debug.log'), 'x\n');
      writeFileSync(path.join(temp.repoRoot, 'kept.txt'), 'x\n');
      const svc = new WorkingTreeService(
        mockGitExtensionService([mockRepository(temp.repoRoot)]),
        mockCliRegistry(temp.repoRoot, temp.cli),
      );
      const ignored = await svc.listIgnored(temp.repoRoot);
      assert.deepEqual(ignored.map((entry) => entry.path).sort(), ['debug.log', 'dist/']);
      assert.ok(ignored.every((entry) => entry.status === 'ignored' && entry.group === 'untracked'));
    } finally {
      temp.cleanup();
    }
  });
});
