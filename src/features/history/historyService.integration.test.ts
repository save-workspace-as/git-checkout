import { strict as assert } from 'node:assert';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { HistoryService } from './historyService';
import { commitEmptyAt, initTempRepository, runGit } from '../../core/testing/gitRepoHarness';
import { mockCliRegistry } from '../../core/testing/serviceTestUtils';

async function setUp() {
  const repo = initTempRepository();
  const service = new HistoryService(mockCliRegistry(repo.repoRoot, repo.cli));
  const head = async () => (await repo.cli.execRead(['rev-parse', 'HEAD'])).stdout.trim();
  return { repo, service, head };
}

describe('HistoryService last operation', () => {
  it('goes back to the commit before an amend, with the branch it moved', async () => {
    const { repo, service, head } = await setUp();
    try {
      commitEmptyAt(repo.repoRoot, 'first', 1_700_000_000);
      const before = await head();
      runGit(repo.repoRoot, ['commit', '--allow-empty', '--amend', '-m', '"first, reworded"']);

      const last = await service.lastOperation(repo.repoRoot);

      assert.equal(last?.label, 'Amend');
      assert.equal(last?.previousSha, before);
      assert.equal(last?.currentSha, await head());
      assert.equal(last?.previousSummary, `${before.slice(0, 7)} first`);
      assert.ok(last?.branch);
    } finally {
      repo.cleanup();
    }
  });

  it('undoes a reset, and undoing again redoes it', async () => {
    const { repo, service, head } = await setUp();
    try {
      commitEmptyAt(repo.repoRoot, 'one', 1_700_000_000);
      commitEmptyAt(repo.repoRoot, 'two', 1_700_000_100);
      const tip = await head();
      runGit(repo.repoRoot, ['reset', '--hard', 'HEAD~1']);
      const afterReset = await head();

      const undo = await service.lastOperation(repo.repoRoot);
      assert.equal(undo?.label, 'Reset');
      assert.equal(undo?.previousSha, tip);
      await service.reset(repo.repoRoot, 'keep', tip);
      assert.equal(await head(), tip);

      const redo = await service.lastOperation(repo.repoRoot);
      assert.equal(redo?.previousSha, afterReset);
    } finally {
      repo.cleanup();
    }
  });

  it('keeps local changes when asked to, and stops when they would be overwritten', async () => {
    const { repo, service, head } = await setUp();
    try {
      runGit(repo.repoRoot, ['commit', '--allow-empty', '-m', 'base']);
      runGit(repo.repoRoot, ['commit', '--allow-empty', '-m', 'second']);
      const tip = await head();
      runGit(repo.repoRoot, ['reset', '--hard', 'HEAD~1']);
      // `--keep` leaves unrelated local changes alone.
      writeFileSync(join(repo.repoRoot, 'local.txt'), 'mine\n');

      await service.reset(repo.repoRoot, 'keep', tip);

      assert.equal(await head(), tip);
      assert.match((await repo.cli.execRead(['status', '--porcelain'])).stdout, /local\.txt/);
    } finally {
      repo.cleanup();
    }
  });

  it('has nothing to undo on a new branch, or on a detached HEAD', async () => {
    const { repo, service, head } = await setUp();
    try {
      commitEmptyAt(repo.repoRoot, 'one', 1_700_000_000);
      runGit(repo.repoRoot, ['switch', '-c', 'fresh']);
      assert.equal(await service.lastOperation(repo.repoRoot), undefined);

      runGit(repo.repoRoot, ['checkout', '--detach', await head()]);
      assert.equal(await service.lastOperation(repo.repoRoot), undefined);
    } finally {
      repo.cleanup();
    }
  });
});
