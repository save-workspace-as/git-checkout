import { strict as assert } from 'node:assert';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { initTempRepository, runGit } from '../../core/testing/gitRepoHarness';
import { mockCliRegistry } from '../../core/testing/serviceTestUtils';
import { StatisticsService } from './statisticsService';

describe('StatisticsService with real git', () => {
  it('counts commits, branches, tags and contributors', async () => {
    const repo = initTempRepository();
    try {
      for (const name of ['a', 'b', 'c']) {
        writeFileSync(join(repo.repoRoot, `${name}.txt`), name);
        runGit(repo.repoRoot, ['add', `${name}.txt`]);
        runGit(repo.repoRoot, ['commit', '-m', name]);
      }
      runGit(repo.repoRoot, ['branch', 'topic']);
      runGit(repo.repoRoot, ['tag', 'v1']);
      const stats = await new StatisticsService(mockCliRegistry(repo.repoRoot, repo.cli)).load(repo.repoRoot);
      assert.equal(stats.commits, 3);
      assert.equal(stats.branches, 2);
      assert.equal(stats.tags, 1);
      assert.deepEqual(stats.contributors.map((entry) => [entry.name, entry.commits]), [['git-checkout-test', 3]]);
      assert.match(stats.firstCommit ?? '', /^\d{4}-\d{2}-\d{2}T/);
      assert.ok(stats.sizes.packed.length > 0);
    } finally {
      repo.cleanup();
    }
  });
});
