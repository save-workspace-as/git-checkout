import { execSync } from 'node:child_process';
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { BisectService } from './bisectService';
import { commitEmptyAt, initTempRepository } from '../../core/testing/gitRepoHarness';
import { resolveRepositoryLayout } from '../../core/gitRepositoryLayout';
import { mockCliRegistry } from '../../core/testing/serviceTestUtils';

describe('BisectService', () => {
  it('starts, marks, skips, and resumes from the git bisect files', async () => {
    const repo = initTempRepository();
    const svc = new BisectService(mockCliRegistry(repo.repoRoot, repo.cli));
    try {
      for (let i = 1; i <= 5; i++) {
        commitEmptyAt(repo.repoRoot, `c${i}`, 1_700_000_000 + i);
      }
      const bad = runRev(repo.repoRoot, ['rev-parse', 'HEAD']);
      const good = runRev(repo.repoRoot, ['rev-parse', 'HEAD~4']);

      await svc.start(repo.repoRoot, bad, good);
      const started = await svc.read(repo.repoRoot);
      const checkedOut = runRev(repo.repoRoot, ['rev-parse', 'HEAD']);
      assert.equal(started.active, true);
      assert.equal(started.currentSha, checkedOut);
      assert.notEqual(started.currentSha, bad);
      assert.ok(started.good.includes(good));
      assert.ok(started.bad.includes(bad));
      assert.equal(started.firstBadSha, null);
      assert.match(started.summary, /^Testing /);

      const testing = started.currentSha;
      assert.ok(testing);
      await svc.mark(repo.repoRoot, 'skip', testing);
      const skipped = await svc.read(repo.repoRoot);
      assert.ok(skipped.skip.includes(testing));
      assert.notEqual(skipped.currentSha, testing);
      assert.equal(skipped.currentSha, runRev(repo.repoRoot, ['rev-parse', 'HEAD']));

      await svc.mark(repo.repoRoot, 'good');
      const progressed = await svc.read(repo.repoRoot);
      assert.ok(progressed.good.includes(skipped.currentSha ?? ''));
      assert.equal(progressed.currentSha, runRev(repo.repoRoot, ['rev-parse', 'HEAD']));

      const resumed = await new BisectService(mockCliRegistry(repo.repoRoot, repo.cli)).read(repo.repoRoot);
      assert.equal(resumed.currentSha, progressed.currentSha);
      assert.deepEqual(resumed.good, progressed.good);
      assert.deepEqual(resumed.bad, progressed.bad);
      assert.deepEqual(resumed.skip, progressed.skip);

      await svc.reset(repo.repoRoot);
      const idle = await svc.read(repo.repoRoot);
      assert.equal(idle.active, false);
      assert.equal(idle.currentSha, null);
      const gitDir = (await resolveRepositoryLayout(repo.cli, repo.repoRoot)).gitDir;
      assert.equal(existsSync(join(gitDir, 'BISECT_LOG')), false);
      assert.equal(runRev(repo.repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']), 'main');
    } finally {
      repo.cleanup();
    }
  });

  it('selects HEAD when bisect starts before a good revision is known', async () => {
    const repo = initTempRepository();
    const svc = new BisectService(mockCliRegistry(repo.repoRoot, repo.cli));
    try {
      commitEmptyAt(repo.repoRoot, 'only', 1_700_000_100);
      const head = runRev(repo.repoRoot, ['rev-parse', 'HEAD']);
      await svc.start(repo.repoRoot, '', '');
      const state = await svc.read(repo.repoRoot);
      assert.equal(state.active, true);
      assert.equal(state.currentSha, head);
      assert.deepEqual(state.good, []);
      assert.deepEqual(state.bad, []);
      assert.equal(state.summary, `Testing ${head.slice(0, 7)}`);
    } finally {
      repo.cleanup();
    }
  });
});

function runRev(repoRoot: string, args: string[]): string {
  return execSync(['git', ...args].join(' '), { cwd: repoRoot, encoding: 'utf8' }).trim();
}
