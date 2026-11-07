import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { initTempRepository, runGit } from '../../core/testing/gitRepoHarness';
import type { RestTransport } from './githubRestClient';
import type { StackPlan } from './pullRequestStackForm';
import { createPullRequests } from './stackPullRequests';

const repo = { host: 'github.com', owner: 'octo', repo: 'app' };
type Repo = ReturnType<typeof initTempRepository>;

async function commit(r: Repo, file: string, message: string): Promise<string> {
  writeFileSync(path.join(r.repoRoot, file), `${message}\n`);
  await r.cli.execWrite(['add', file]);
  await r.cli.execWrite(['commit', '-m', message]);
  return (await r.cli.execRead(['rev-parse', 'HEAD'])).stdout.trim();
}

/** A GitHub that keeps pull requests and stacks in memory. */
function fakeGitHub(open: Record<string, { number: number; base: string }> = {}, stackStatus = 201) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  let next = 10;
  const transport: RestTransport = {
    async request(method, url, _token, body) {
      calls.push({ method, url, body });
      const pulls = 'https://api.github.com/repos/octo/app/pulls';
      if (method === 'GET' && url.startsWith(`${pulls}?`)) {
        const head = decodeURIComponent(url.split('head=')[1]).replace('octo:', '');
        const found = open[head];
        return { status: 200, json: found ? [{ number: found.number, html_url: `https://github.com/octo/app/pull/${found.number}`, base: { ref: found.base } }] : [] };
      }
      if (method === 'POST' && url === pulls) {
        const input = body as { head: string; base: string; draft: boolean };
        const number = next++;
        return { status: 201, json: { number, html_url: `https://github.com/octo/app/pull/${number}`, base: { ref: input.base }, draft: input.draft } };
      }
      if (method === 'PATCH') {
        const number = Number(url.split('/').pop());
        return { status: 200, json: { number, html_url: `https://github.com/octo/app/pull/${number}`, base: { ref: (body as { base: string }).base } } };
      }
      if (method === 'POST' && url.endsWith('/stacks')) {
        return stackStatus === 201
          ? { status: 201, json: { number: 3, url: 'https://api.github.com/repos/octo/app/stacks/3', pull_requests: (body as { pull_requests: number[] }).pull_requests.map((number) => ({ number })) } }
          : { status: stackStatus, json: { message: 'Resource not accessible by integration' } };
      }
      return { status: 500, json: null };
    },
  };
  return { transport, calls };
}

/** A repository with a remote, and a branch of three commits cut into two layers. */
async function setUp() {
  const r = initTempRepository();
  const remote = mkdtempSync(path.join(tmpdir(), 'git-checkout-remote-'));
  runGit(remote, ['init', '--bare', '--initial-branch=main']);
  await commit(r, 'a.txt', 'base');
  runGit(r.repoRoot, ['remote', 'add', 'origin', remote]);
  runGit(r.repoRoot, ['push', 'origin', 'main']);
  runGit(r.repoRoot, ['checkout', '-b', 'feat/x']);
  const first = await commit(r, 'b.txt', 'add schema');
  await commit(r, 'c.txt', 'add api');
  const top = await commit(r, 'd.txt', 'add page');
  const plan: StackPlan = {
    draft: true,
    link: true,
    layers: [
      { branch: 'feat/x-schema', sha: first, created: true, base: 'main', title: 'Add schema', body: '' },
      { branch: 'feat/x', sha: top, created: false, base: 'feat/x-schema', title: 'Add API and page', body: '- add api\n- add page' },
    ],
  };
  const remoteBranches = async () => (await r.cli.execRead(['ls-remote', '--heads', 'origin'])).stdout.split('\n').filter(Boolean).map((line) => line.split('refs/heads/')[1]).sort();
  return { r, plan, first, remoteBranches, cleanup: () => { r.cleanup(); rmSync(remote, { recursive: true, force: true }); } };
}

describe('createPullRequests integration', () => {
  it('makes the branch of the lower layer at its commit, pushes both, opens the pull requests bottom first and groups them', async () => {
    const s = await setUp();
    try {
      const github = fakeGitHub();
      const outcome = await createPullRequests(s.r.cli, 'origin', repo, 'secret', s.plan, github.transport);

      assert.equal((await s.r.cli.execRead(['rev-parse', 'feat/x-schema'])).stdout.trim(), s.first);
      assert.deepEqual(await s.remoteBranches(), ['feat/x', 'feat/x-schema', 'main']);
      assert.equal((await s.r.cli.execRead(['rev-parse', '--abbrev-ref', 'feat/x-schema@{upstream}'])).stdout.trim(), 'origin/feat/x-schema');

      assert.deepEqual(outcome.pullRequests.map((p) => [p.number, p.branch]), [[10, 'feat/x-schema'], [11, 'feat/x']]);
      const created = github.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/pulls')).map((c) => c.body);
      assert.deepEqual(created, [
        { title: 'Add schema', head: 'feat/x-schema', base: 'main', body: '', draft: true },
        { title: 'Add API and page', head: 'feat/x', base: 'feat/x-schema', body: '- add api\n- add page', draft: true },
      ]);
      assert.deepEqual(github.calls.at(-1)?.body, { pull_requests: [10, 11] });
      assert.equal(outcome.stack?.number, 3);
    } finally {
      s.cleanup();
    }
  });

  it('carries on after a failure: uses the branch and the open pull request that are there, and corrects a base', async () => {
    const s = await setUp();
    try {
      runGit(s.r.repoRoot, ['branch', 'feat/x-schema', s.first]);
      const github = fakeGitHub({ 'feat/x-schema': { number: 5, base: 'main' }, 'feat/x': { number: 6, base: 'main' } });
      const outcome = await createPullRequests(s.r.cli, 'origin', repo, 't', s.plan, github.transport);

      assert.deepEqual(outcome.pullRequests.map((p) => p.number), [5, 6]);
      assert.deepEqual(github.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/pulls')), [], 'nothing is opened twice');
      const patches = github.calls.filter((c) => c.method === 'PATCH');
      assert.deepEqual(patches.map((c) => [c.url, c.body]), [['https://api.github.com/repos/octo/app/pulls/6', { base: 'feat/x-schema' }]]);
    } finally {
      s.cleanup();
    }
  });

  it('refuses a branch that exists at another commit, before anything is pushed', async () => {
    const s = await setUp();
    try {
      runGit(s.r.repoRoot, ['branch', 'feat/x-schema', 'main']);
      const github = fakeGitHub();
      await assert.rejects(() => createPullRequests(s.r.cli, 'origin', repo, 't', s.plan, github.transport), /not at the commit chosen/);
      assert.deepEqual(await s.remoteBranches(), ['main']);
      assert.equal(github.calls.length, 0);
    } finally {
      s.cleanup();
    }
  });

  it('keeps the pull requests and says why they are not a stack when GitHub refuses the stack', async () => {
    const s = await setUp();
    try {
      const outcome = await createPullRequests(s.r.cli, 'origin', repo, 't', s.plan, fakeGitHub({}, 403).transport);
      assert.equal(outcome.pullRequests.length, 2);
      assert.equal(outcome.stack, undefined);
      assert.match(outcome.stackProblem ?? '', /not accessible/);
    } finally {
      s.cleanup();
    }
  });

  it('does not group a single pull request, or when asked not to', async () => {
    const s = await setUp();
    try {
      const github = fakeGitHub();
      await createPullRequests(s.r.cli, 'origin', repo, 't', { ...s.plan, link: false }, github.transport);
      assert.ok(!github.calls.some((c) => c.url.endsWith('/stacks')), 'not asked for');
      const alone = fakeGitHub();
      await createPullRequests(s.r.cli, 'origin', repo, 't', { ...s.plan, layers: [s.plan.layers[1]] }, alone.transport);
      assert.ok(!alone.calls.some((c) => c.url.endsWith('/stacks')), 'one pull request is not a stack');
    } finally {
      s.cleanup();
    }
  });
});
