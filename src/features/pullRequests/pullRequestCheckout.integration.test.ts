import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { initTempRepository, runGit, type TempGitRepository } from '../../core/testing/gitRepoHarness';
import { checkoutPullRequestBranch, fetchPullRequestHead, preparePullRequestBranch, resetPullRequestBranch } from './pullRequestCheckout';

/** A repository whose remote has pull request 7 at `refs/pull/7/head`, as GitHub keeps them. */
async function setUp() {
  const repo = initTempRepository();
  const remote = mkdtempSync(join(tmpdir(), 'git-checkout-pr-remote-'));
  runGit(remote, ['init', '--bare', '-q']);
  const commit = async (name: string): Promise<string> => {
    writeFileSync(join(repo.repoRoot, name), `${name}\n`);
    runGit(repo.repoRoot, ['add', name]);
    await repo.cli.execWrite(['commit', '-m', name]);
    return (await repo.cli.execRead(['rev-parse', 'HEAD'])).stdout.trim();
  };
  await commit('base.txt');
  runGit(repo.repoRoot, ['remote', 'add', 'origin', remote]);
  const publish = async (number: number, sha: string): Promise<void> => {
    runGit(repo.repoRoot, ['push', '-q', '--force', 'origin', `${sha}:refs/pull/${number}/head`]);
  };
  const read = async (...args: string[]) => (await repo.cli.execRead(args)).stdout.trim();
  return { repo, remote, commit, publish, read, cleanup: () => { repo.cleanup(); rmSync(remote, { recursive: true, force: true }); } };
}

async function fromBranch(repo: TempGitRepository, branch: string, name: string): Promise<string> {
  runGit(repo.repoRoot, ['checkout', '-q', '-b', branch]);
  writeFileSync(join(repo.repoRoot, name), `${name}\n`);
  runGit(repo.repoRoot, ['add', name]);
  await repo.cli.execWrite(['commit', '-m', name]);
  const sha = (await repo.cli.execRead(['rev-parse', 'HEAD'])).stdout.trim();
  runGit(repo.repoRoot, ['checkout', '-q', 'main']);
  return sha;
}

describe('pull request checkout', () => {
  it('fetches the head of a pull request by number', async () => {
    const t = await setUp();
    try {
      const head = await fromBranch(t.repo, 'feature', 'feature.txt');
      await t.publish(7, head);
      runGit(t.repo.repoRoot, ['branch', '-D', 'feature']);
      assert.equal(await fetchPullRequestHead(t.repo.cli, 'origin', 7), head);
    } finally {
      t.cleanup();
    }
  });

  it('makes the branch pr/<n> at the head, without leaving the current branch, and then checks it out', async () => {
    const t = await setUp();
    try {
      const head = await fromBranch(t.repo, 'feature', 'feature.txt');
      await t.publish(7, head);
      runGit(t.repo.repoRoot, ['branch', '-D', 'feature']);
      const result = await preparePullRequestBranch(t.repo.cli, 'origin', 7);
      assert.deepEqual(result, { kind: 'ready', branch: 'pr/7', sha: head });
      assert.equal(await t.read('branch', '--show-current'), 'main');
      assert.equal(await t.read('rev-parse', 'pr/7'), head);
      await checkoutPullRequestBranch(t.repo.cli, 'pr/7');
      assert.equal(await t.read('branch', '--show-current'), 'pr/7');
    } finally {
      t.cleanup();
    }
  });

  it('moves an existing pr/<n> forward when the pull request got new commits, also while it is checked out', async () => {
    const t = await setUp();
    try {
      const first = await fromBranch(t.repo, 'feature', 'one.txt');
      await t.publish(7, first);
      await preparePullRequestBranch(t.repo.cli, 'origin', 7);
      runGit(t.repo.repoRoot, ['checkout', '-q', 'feature']);
      const second = await t.commit('two.txt');
      runGit(t.repo.repoRoot, ['checkout', '-q', 'main']);
      await t.publish(7, second);

      assert.deepEqual(await preparePullRequestBranch(t.repo.cli, 'origin', 7), { kind: 'ready', branch: 'pr/7', sha: second });
      assert.equal(await t.read('rev-parse', 'pr/7'), second, 'moved while another branch was checked out');

      const third = await (async () => { runGit(t.repo.repoRoot, ['checkout', '-q', 'feature']); const sha = await t.commit('three.txt'); runGit(t.repo.repoRoot, ['checkout', '-q', 'main']); return sha; })();
      await t.publish(7, third);
      await checkoutPullRequestBranch(t.repo.cli, 'pr/7');
      assert.deepEqual(await preparePullRequestBranch(t.repo.cli, 'origin', 7), { kind: 'ready', branch: 'pr/7', sha: third });
      assert.equal(await t.read('rev-parse', 'HEAD'), third, 'and moved forward while checked out');
    } finally {
      t.cleanup();
    }
  });

  it('reports a pr/<n> that has commits of its own instead of moving it, and moves it only when told to', async () => {
    const t = await setUp();
    try {
      const head = await fromBranch(t.repo, 'feature', 'feature.txt');
      await t.publish(7, head);
      runGit(t.repo.repoRoot, ['branch', 'pr/7', 'main']);
      runGit(t.repo.repoRoot, ['checkout', '-q', 'pr/7']);
      const mine = await t.commit('mine.txt');

      const result = await preparePullRequestBranch(t.repo.cli, 'origin', 7);
      assert.deepEqual(result, { kind: 'diverged', branch: 'pr/7', sha: head });
      assert.equal(await t.read('rev-parse', 'pr/7'), mine, 'nothing moved');

      await resetPullRequestBranch(t.repo.cli, 'pr/7', head);
      assert.equal(await t.read('rev-parse', 'HEAD'), head);
      assert.equal(await t.read('branch', '--show-current'), 'pr/7');
    } finally {
      t.cleanup();
    }
  });

  it('fails for a pull request the remote does not have', async () => {
    const t = await setUp();
    try {
      await assert.rejects(fetchPullRequestHead(t.repo.cli, 'origin', 99));
    } finally {
      t.cleanup();
    }
  });
});
