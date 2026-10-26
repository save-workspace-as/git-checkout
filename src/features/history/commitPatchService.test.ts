import { strict as assert } from 'node:assert';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { CommitPatchService } from './commitPatchService';
import { HistoryService } from './historyService';
import { initTempRepository, runGit } from '../../core/testing/gitRepoHarness';
import { mockCliRegistry } from '../../core/testing/serviceTestUtils';

describe('CommitPatchService integration', () => {
  it('exports format-patch for a commit range and applies with git am', async () => {
    const repo = initTempRepository();
    try {
      const file = join(repo.repoRoot, 'feature.txt');
      writeFileSync(file, 'v1\n');
      runGit(repo.repoRoot, ['add', 'feature.txt']);
      runGit(repo.repoRoot, ['commit', '-m', 'base']);

      writeFileSync(file, 'v2\n');
      runGit(repo.repoRoot, ['commit', '-am', 'second']);

      const head = (await repo.cli.execRead(['rev-parse', 'HEAD'])).stdout.trim();
      const parent = (await repo.cli.execRead(['rev-parse', 'HEAD^'])).stdout.trim();

      runGit(repo.repoRoot, ['branch', 'apply-target', parent]);

      const registry = mockCliRegistry(repo.repoRoot, repo.cli);
      const history = new HistoryService(registry);
      const svc = new CommitPatchService(registry, history);

      const patch = await svc.exportCommits(repo.repoRoot, [head], 'format-patch');
      assert.match(patch, /^From /m);
      assert.match(patch, /second/);

      runGit(repo.repoRoot, ['checkout', 'apply-target']);
      await svc.applyFromText(repo.repoRoot, patch);

      const content = (await repo.cli.execRead(['show', 'HEAD:feature.txt'])).stdout;
      assert.equal(content, 'v2\n');
    } finally {
      repo.cleanup();
    }
  });

  it('exports unified diff and applies with git apply', async () => {
    const repo = initTempRepository();
    try {
      const file = join(repo.repoRoot, 'delta.txt');
      writeFileSync(file, 'a\n');
      runGit(repo.repoRoot, ['add', 'delta.txt']);
      runGit(repo.repoRoot, ['commit', '-m', 'base']);

      writeFileSync(file, 'b\n');
      runGit(repo.repoRoot, ['commit', '-am', 'change']);

      const head = (await repo.cli.execRead(['rev-parse', 'HEAD'])).stdout.trim();

      const registry = mockCliRegistry(repo.repoRoot, repo.cli);
      const history = new HistoryService(registry);
      const svc = new CommitPatchService(registry, history);

      const diff = await svc.exportCommits(repo.repoRoot, [head], 'diff');
      assert.match(diff, /^diff --git/m);

      runGit(repo.repoRoot, ['reset', '--hard', 'HEAD^']);
      await svc.applyFromText(repo.repoRoot, diff);

      const readBack = (await repo.cli.execRead(['show', ':delta.txt'])).stdout;
      assert.equal(readBack, 'b\n');
    } finally {
      repo.cleanup();
    }
  });
});
