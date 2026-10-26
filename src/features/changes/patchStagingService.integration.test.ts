import { strict as assert } from 'node:assert';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { DEFAULT_COMMIT_DIFF_VIEW } from '../../shared/diff/commitDiffPresentation';
import { buildHunkPatch, hunkCount } from '../../shared/changes/hunkPatch';
import { CommitDetailsService } from '../history/commitDetailsService';
import { PatchStagingService } from './patchStagingService';
import { initTempRepository, runGit } from '../../core/testing/gitRepoHarness';
import { mockCliRegistry, mockGitExtensionService, mockRepository } from '../../core/testing/serviceTestUtils';

describe('PatchStagingService integration', () => {
  it('stages a single hunk via git apply --cached', async () => {
    const repo = initTempRepository();
    try {
      const file = join(repo.repoRoot, 'sample.txt');
      writeFileSync(file, 'one\ntwo\nthree\n');
      runGit(repo.repoRoot, ['add', 'sample.txt']);
      runGit(repo.repoRoot, ['commit', '-m', 'base']);

      writeFileSync(file, 'one\nTWO\nthree\nfour\n');
      const mockRepo = mockRepository(repo.repoRoot);
      const svc = new PatchStagingService(
        mockGitExtensionService([mockRepo]),
        mockCliRegistry(repo.repoRoot, repo.cli),
      );

      const diff = await svc.loadFileDiff(repo.repoRoot, 'sample.txt', 'unstaged');
      assert.equal(diff.hunks.length, 1);
      assert.ok(diff.hunks[0].lines.some((line) => line.kind === 'add'));

      await svc.runPatchAction(repo.repoRoot, {
        op: 'stageHunk',
        path: 'sample.txt',
        hunkId: '0',
      });

      const staged = await repo.cli.execRead(['diff', '--cached', '--name-only']);
      assert.match(staged.stdout, /sample\.txt/);
      const unstaged = await repo.cli.execRead(['diff', '--name-only']);
      assert.equal(unstaged.stdout.trim(), '');
    } finally {
      repo.cleanup();
    }
  });

  it('does not crash when skip-worktree file has no diff', async () => {
    const repo = initTempRepository();
    try {
      const file = join(repo.repoRoot, 'skip.txt');
      writeFileSync(file, 'a\n');
      runGit(repo.repoRoot, ['add', 'skip.txt']);
      runGit(repo.repoRoot, ['commit', '-m', 'base']);
      runGit(repo.repoRoot, ['update-index', '--skip-worktree', '--', 'skip.txt']);

      const mockRepo = mockRepository(repo.repoRoot);
      const svc = new PatchStagingService(
        mockGitExtensionService([mockRepo]),
        mockCliRegistry(repo.repoRoot, repo.cli),
      );

      const diff = await svc.loadFileDiff(repo.repoRoot, 'skip.txt', 'unstaged');
      assert.equal(diff.binary, false);
      assert.equal(diff.hunks.length, 0);
      assert.equal(diff.error, undefined);
    } finally {
      repo.cleanup();
    }
  });

  it('stages, unstages and discards one hunk of the diff on screen, whatever options made it', async () => {
    const repo = initTempRepository();
    try {
      const file = join(repo.repoRoot, 'sample.txt');
      const base = Array.from({ length: 30 }, (_, i) => `line ${i}`);
      writeFileSync(file, `${base.join('\n')}\n`);
      runGit(repo.repoRoot, ['add', 'sample.txt']);
      runGit(repo.repoRoot, ['commit', '-m', 'base']);
      const edited = [...base];
      edited[2] = 'first edit';
      edited[25] = 'second edit';
      writeFileSync(file, `${edited.join('\n')}\n`);

      const registry = mockCliRegistry(repo.repoRoot, repo.cli);
      const svc = new PatchStagingService(mockGitExtensionService([mockRepository(repo.repoRoot)]), registry);
      const details = new CommitDetailsService(registry);
      // Few lines of context, so the two edits are separate hunks, as the toolbar can make them.
      const view = { ...DEFAULT_COMMIT_DIFF_VIEW, contextLines: 1 };
      const diff = async (side: 'staged' | 'unstaged') =>
        (await details.diffWorkingFile(repo.repoRoot, 'sample.txt', side, false, view)).lines;
      assert.equal(hunkCount(await diff('unstaged')), 2);

      await svc.applyHunkPatch(repo.repoRoot, 'stage', buildHunkPatch('sample.txt', await diff('unstaged'), 1)!);
      const staged = await diff('staged');
      assert.deepEqual(staged.filter((line) => line.kind === 'add').map((line) => line.text), ['second edit']);
      assert.deepEqual((await diff('unstaged')).filter((line) => line.kind === 'add').map((line) => line.text), ['first edit']);

      await svc.applyHunkPatch(repo.repoRoot, 'unstage', buildHunkPatch('sample.txt', staged, 0)!);
      assert.equal(hunkCount(await diff('staged')), 0);

      await svc.applyHunkPatch(repo.repoRoot, 'discard', buildHunkPatch('sample.txt', await diff('unstaged'), 0)!);
      const remaining = (await diff('unstaged')).filter((line) => line.kind === 'add').map((line) => line.text);
      assert.deepEqual(remaining, ['second edit']);
    } finally {
      repo.cleanup();
    }
  });
});

