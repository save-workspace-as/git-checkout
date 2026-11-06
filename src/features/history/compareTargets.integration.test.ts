import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { initTempRepository, runGit } from '../../core/testing/gitRepoHarness';
import { resolveCompare } from './compareTargets';

describe('resolveCompare with git', () => {
  it('finds the merge base, the upstream and a tag in a real repository', async () => {
    const repo = initTempRepository();
    try {
      const git = (...args: string[]) => runGit(repo.repoRoot, args);
      const sha = async (revision: string) => (await repo.cli.execRead(['rev-parse', revision])).stdout.trim();
      git('commit', '--allow-empty', '-m', 'base');
      const base = await sha('HEAD');
      git('tag', 'v1');
      git('checkout', '-q', '-b', 'topic');
      git('commit', '--allow-empty', '-m', 'topic-work');
      const topic = await sha('HEAD');
      git('checkout', '-q', '-');
      git('commit', '--allow-empty', '-m', 'main-work');
      const head = await sha('HEAD');

      assert.deepEqual(await resolveCompare(repo.cli, 'mergeBase', topic), { ok: true, base, head: topic });
      assert.deepEqual(await resolveCompare(repo.cli, 'head', topic), { ok: true, base: topic, head });
      assert.deepEqual(await resolveCompare(repo.cli, 'ref', topic, 'v1'), { ok: true, base, head: topic });
      assert.equal((await resolveCompare(repo.cli, 'upstream', topic, 'topic')).ok, false);
      git('update-ref', 'refs/remotes/origin/topic', base);
      git('remote', 'add', 'origin', '.');
      git('branch', '--set-upstream-to=origin/topic', 'topic');
      assert.deepEqual(await resolveCompare(repo.cli, 'upstream', topic, 'topic'), { ok: true, base, head: topic });
    } finally {
      repo.cleanup();
    }
  });
});
