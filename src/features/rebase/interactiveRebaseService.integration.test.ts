import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { InteractiveRebaseService } from './interactiveRebaseService';
import { initTempRepository, runGit } from '../../core/testing/gitRepoHarness';
import {
  mockCliRegistry,
  mockGitExtensionService,
  mockRepository,
} from '../../core/testing/serviceTestUtils';
import { WorkingTreeService } from '../changes/workingTreeService';
import { buildPickLines } from './rebaseTodo';

describe('InteractiveRebaseService integration', () => {
  it('retains inline messages across an edit stop and rejects empty messages', async () => {
    const repo = initTempRepository();
    try {
      runGit(repo.repoRoot, ['commit', '--allow-empty', '-m', 'base']);
      const base = (await repo.cli.execRead(['rev-parse', 'HEAD'])).stdout.trim();
      runGit(repo.repoRoot, ['commit', '--allow-empty', '-m', 'edit-stop']);
      const first = (await repo.cli.execRead(['rev-parse', 'HEAD'])).stdout.trim();
      runGit(repo.repoRoot, ['commit', '--allow-empty', '-m', 'reword-later']);
      const second = (await repo.cli.execRead(['rev-parse', 'HEAD'])).stdout.trim();
      const registry = mockCliRegistry(repo.repoRoot, repo.cli);
      const service = new InteractiveRebaseService(registry, new WorkingTreeService(
        mockGitExtensionService([mockRepository(repo.repoRoot)]), registry,
      ));
      await assert.rejects(service.start(repo.repoRoot, {
        onto: base, upstream: base,
        lines: [{ kind: 'commit', command: 'reword', hash: second, subject: 'reword later', message: ' \n' }],
      }), /non-empty commit message/);
      assert.equal((await repo.cli.execRead(['rev-parse', 'HEAD'])).stdout.trim(), second);
      await service.start(repo.repoRoot, {
        onto: base, upstream: base,
        lines: [
          { kind: 'commit', command: 'edit', hash: first, subject: 'edit stop' },
          { kind: 'commit', command: 'reword', hash: second, subject: 'reword later', message: 'Changed after resume\n\nBody' },
        ],
      });
      assert.equal((await service.readSequencer(repo.repoRoot))?.active, true);
      await service.continue(repo.repoRoot);
      assert.equal((await repo.cli.execRead(['log', '-1', '--format=%B'])).stdout.trim(), 'Changed after resume\n\nBody');
      assert.ok(!(await service.readSequencer(repo.repoRoot))?.active);
    } finally {
      repo.cleanup();
    }
  });

  it('rewords multiple commits with multiline messages without invoking an external editor', async () => {
    const repo = initTempRepository();
    try {
      runGit(repo.repoRoot, ['commit', '--allow-empty', '-m', 'base']);
      const base = (await repo.cli.execRead(['rev-parse', 'HEAD'])).stdout.trim();
      runGit(repo.repoRoot, ['commit', '--allow-empty', '-m', 'first']);
      const first = (await repo.cli.execRead(['rev-parse', 'HEAD'])).stdout.trim();
      runGit(repo.repoRoot, ['commit', '--allow-empty', '-m', 'second']);
      const second = (await repo.cli.execRead(['rev-parse', 'HEAD'])).stdout.trim();
      const registry = mockCliRegistry(repo.repoRoot, repo.cli);
      const service = new InteractiveRebaseService(registry, new WorkingTreeService(
        mockGitExtensionService([mockRepository(repo.repoRoot)]), registry,
      ));
      await service.start(repo.repoRoot, {
        onto: base, upstream: base,
        lines: [
          { kind: 'commit', command: 'reword', hash: first, subject: 'first', message: "New first 'subject'\n\nFirst body" },
          { kind: 'commit', command: 'reword', hash: second, subject: 'second', message: 'New second\n\nSecond body' },
        ],
      });
      assert.equal((await repo.cli.execRead(['log', '-1', '--format=%B'])).stdout.trim(), 'New second\n\nSecond body');
      assert.equal((await repo.cli.execRead(['log', '-1', '--format=%B', 'HEAD^'])).stdout.trim(), "New first 'subject'\n\nFirst body");
    } finally {
      repo.cleanup();
    }
  });

  it('drops a commit via scripted interactive rebase', async () => {
    const repo = initTempRepository();
    try {
      runGit(repo.repoRoot, ['commit', '--allow-empty', '-m', 'base']);
      runGit(repo.repoRoot, ['commit', '--allow-empty', '-m', 'second']);
      const head = (await repo.cli.execRead(['rev-parse', 'HEAD'])).stdout.trim();
      const parent = (await repo.cli.execRead(['rev-parse', 'HEAD^'])).stdout.trim();

      const gitService = mockGitExtensionService([mockRepository(repo.repoRoot)]);
      const registry = mockCliRegistry(repo.repoRoot, repo.cli);
      // Production GitCliRegistry.runWrite and GitCli.execWrite share one queue.
      // The mock skips that lock; use the real queue so a nested write fails this test.
      registry.runWrite = (root, fn) => {
        if (root !== repo.repoRoot) {
          throw new Error(`unexpected repo root: ${root}`);
        }
        return repo.cli.runWriteTask(fn);
      };
      const service = new InteractiveRebaseService(
        registry,
        new WorkingTreeService(gitService, registry),
      );

      const lines = buildPickLines([{ hash: head, subject: 'second' }]).map((l) => ({
        ...l,
        command: 'drop' as const,
      }));

      await service.start(repo.repoRoot, {
        onto: parent,
        upstream: parent,
        lines,
      });

      const log = (await repo.cli.execRead(['log', '--oneline'])).stdout;
      assert.ok(!log.includes('second'));
      assert.ok(log.includes('base'));
      const newHead = (await repo.cli.execRead(['rev-parse', 'HEAD'])).stdout.trim();
      assert.equal(newHead, parent);
    } finally {
      repo.cleanup();
    }
  });
});
