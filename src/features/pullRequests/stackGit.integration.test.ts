import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { initTempRepository, runGit } from '../../core/testing/gitRepoHarness';
import { pushStackArgs } from './stackGit';

type Repo = ReturnType<typeof initTempRepository>;

async function commit(r: Repo, file: string, message: string): Promise<void> {
  writeFileSync(path.join(r.repoRoot, file), `${message}\n`);
  await r.cli.execWrite(['add', file]);
  await r.cli.execWrite(['commit', '-m', message]);
}

async function setUp() {
  const r = initTempRepository();
  const remote = mkdtempSync(path.join(tmpdir(), 'git-checkout-push-stack-'));
  runGit(remote, ['init', '--bare', '--initial-branch=main']);
  await commit(r, 'a.txt', 'base');
  runGit(r.repoRoot, ['remote', 'add', 'origin', remote]);
  runGit(r.repoRoot, ['push', 'origin', 'main']);
  for (const name of ['one', 'two']) {
    runGit(r.repoRoot, ['checkout', '-b', name]);
    await commit(r, `${name}.txt`, name);
  }
  const remoteTip = async (branch: string) => (await r.cli.execRead(['ls-remote', 'origin', `refs/heads/${branch}`])).stdout.split('\t')[0];
  const tip = async (branch: string) => (await r.cli.execRead(['rev-parse', branch])).stdout.trim();
  return { r, remoteTip, tip, cleanup: () => { r.cleanup(); rmSync(remote, { recursive: true, force: true }); } };
}

describe('pushing a stack integration', () => {
  it('pushes all the branches in one push', async () => {
    const s = await setUp();
    try {
      await s.r.cli.execWrite(pushStackArgs('origin', ['one', 'two'], false), { network: true });
      assert.equal(await s.remoteTip('one'), await s.tip('one'));
      assert.equal(await s.remoteTip('two'), await s.tip('two'));
    } finally {
      s.cleanup();
    }
  });

  it('replaces rebased branches with a lease, but not ones that moved on the remote', async () => {
    const s = await setUp();
    try {
      await s.r.cli.execWrite(pushStackArgs('origin', ['one', 'two'], false), { network: true });
      runGit(s.r.repoRoot, ['fetch', 'origin']);
      runGit(s.r.repoRoot, ['checkout', 'one']);
      runGit(s.r.repoRoot, ['commit', '--amend', '-m', 'reworded']);
      await assert.rejects(() => s.r.cli.execWrite(pushStackArgs('origin', ['one'], false), { network: true }), 'a plain push is refused');
      await s.r.cli.execWrite(pushStackArgs('origin', ['one'], true), { network: true });
      assert.equal(await s.remoteTip('one'), await s.tip('one'));

      // Someone else pushes to `two`, which this clone has not fetched: the lease holds the push back, and `one` with it.
      const other = path.join(tmpdir(), `git-checkout-other-${Date.now()}`);
      const originUrl = (await s.r.cli.execRead(['remote', 'get-url', 'origin'])).stdout.trim();
      runGit(tmpdir(), ['clone', '-q', '--branch', 'two', originUrl, other]);
      runGit(other, ['commit', '--allow-empty', '-m', 'theirs']);
      runGit(other, ['push', '-q', 'origin', 'two']);
      rmSync(other, { recursive: true, force: true });
      runGit(s.r.repoRoot, ['checkout', 'one']);
      runGit(s.r.repoRoot, ['commit', '--amend', '-m', 'again']);
      runGit(s.r.repoRoot, ['checkout', 'two']);
      runGit(s.r.repoRoot, ['commit', '--amend', '-m', 'amended']);
      const before = await s.remoteTip('one');
      await assert.rejects(() => s.r.cli.execWrite(pushStackArgs('origin', ['one', 'two'], true), { network: true }));
      assert.equal(await s.remoteTip('one'), before, 'nothing was pushed, because the push is atomic');
    } finally {
      s.cleanup();
    }
  });
});
