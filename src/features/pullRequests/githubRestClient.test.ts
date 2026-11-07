import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  addToStack, createPullRequest, createStack, findOpenPullRequest, GitHubRestError, listStacks, restUrl, setPullRequestBase, type RestTransport,
} from './githubRestClient';

const repo = { host: 'github.com', owner: 'octo', repo: 'app' };
type Call = { method: string; url: string; token: string; body: unknown; headers: Record<string, string> | undefined };
const transport = (answer: { status: number; json: unknown } | Error): RestTransport & { calls: Call[] } => {
  const calls: Call[] = [];
  return {
    calls,
    async request(method, url, token, body, headers) {
      calls.push({ method, url, token, body, headers });
      if (answer instanceof Error) {
        throw answer;
      }
      return answer;
    },
  };
};
const pull = { number: 7, html_url: 'https://github.com/octo/app/pull/7', base: { ref: 'main' }, draft: true };
const failureOf = (run: Promise<unknown>) => run.then(() => 'no failure', (error: unknown) => (error instanceof GitHubRestError ? error.failure : String(error)));

describe('restUrl', () => {
  it('uses the API address of github.com and the /api/v3 path of other hosts', () => {
    assert.equal(restUrl(repo, '/pulls'), 'https://api.github.com/repos/octo/app/pulls');
    assert.equal(restUrl({ ...repo, host: 'ghe.example.com' }, '/stacks'), 'https://ghe.example.com/api/v3/repos/octo/app/stacks');
  });
});

describe('createPullRequest', () => {
  it('posts the pull request with the sign-in as the bearer token and reads the number and page back', async () => {
    const t = transport({ status: 201, json: pull });
    const input = { title: 'Add it', head: 'feat/a', base: 'main', body: 'Why', draft: true };
    assert.deepEqual(await createPullRequest(repo, 'secret', input, t), { number: 7, url: 'https://github.com/octo/app/pull/7', base: 'main', draft: true });
    assert.equal(t.calls[0].method, 'POST');
    assert.equal(t.calls[0].url, 'https://api.github.com/repos/octo/app/pulls');
    assert.equal(t.calls[0].token, 'secret');
    assert.deepEqual(t.calls[0].body, input);
    assert.equal(t.calls[0].headers, undefined, 'only the stack endpoints name an API version');
  });

  it('says what went wrong in terms a person can act on, with GitHub\'s own words', async () => {
    const run = (status: number, json: unknown = null) => createPullRequest(repo, 't', { title: '', head: '', base: '', body: '', draft: false }, transport({ status, json }));
    assert.equal(await failureOf(run(401)), 'unauthorized');
    assert.equal(await failureOf(run(403)), 'forbidden');
    assert.equal(await failureOf(run(404)), 'notFound');
    assert.equal(await failureOf(run(409)), 'conflict');
    assert.equal(await failureOf(run(500)), 'other');
    assert.equal(await failureOf(createPullRequest(repo, 't', { title: '', head: '', base: '', body: '', draft: false }, transport(new Error('ENOTFOUND')))), 'network');
    const error = await run(422, { message: 'Validation Failed', errors: [{ message: 'No commits between main and feat/a' }] }).then(() => undefined, (e: unknown) => e as Error);
    assert.equal(error?.message, 'Validation Failed No commits between main and feat/a');
  });

  it('does not trust an answer that is not a pull request', async () => {
    assert.equal(await failureOf(createPullRequest(repo, 't', { title: '', head: '', base: '', body: '', draft: false }, transport({ status: 201, json: { nope: 1 } }))), 'other');
  });
});

describe('findOpenPullRequest', () => {
  it('asks for the open pull request whose head is a branch of the repository itself', async () => {
    const t = transport({ status: 200, json: [pull] });
    assert.equal((await findOpenPullRequest(repo, 't', 'feat/a b', t))?.number, 7);
    assert.equal(t.calls[0].method, 'GET');
    assert.equal(t.calls[0].url, 'https://api.github.com/repos/octo/app/pulls?state=open&head=octo%3Afeat%2Fa%20b');
  });

  it('has none to give when there is no such pull request', async () => {
    assert.equal(await findOpenPullRequest(repo, 't', 'x', transport({ status: 200, json: [] })), undefined);
  });
});

describe('setPullRequestBase', () => {
  it('changes the branch a pull request merges into', async () => {
    const t = transport({ status: 200, json: pull });
    await setPullRequestBase(repo, 't', 7, 'feat/a', t);
    assert.deepEqual([t.calls[0].method, t.calls[0].url, t.calls[0].body], ['PATCH', 'https://api.github.com/repos/octo/app/pulls/7', { base: 'feat/a' }]);
  });
});

describe('createStack', () => {
  it('groups the pull requests, bottom first, with the version of the API that has stacks', async () => {
    const t = transport({ status: 201, json: { number: 9, url: 'https://api.github.com/repos/octo/app/stacks/9', pull_requests: [{ number: 7 }, { number: 8 }] } });
    assert.deepEqual(await createStack(repo, 't', [7, 8], t), { number: 9, url: 'https://api.github.com/repos/octo/app/stacks/9', open: true, pullRequests: [7, 8] });
    assert.equal(t.calls[0].url, 'https://api.github.com/repos/octo/app/stacks');
    assert.deepEqual(t.calls[0].body, { pull_requests: [7, 8] });
    assert.deepEqual(t.calls[0].headers, { 'X-GitHub-Api-Version': '2026-03-10' });
  });

  it('reports a refusal, such as pull requests that cannot form a stack', async () => {
    assert.equal(await failureOf(createStack(repo, 't', [7], transport({ status: 422, json: { message: 'Validation Failed' } }))), 'invalid');
    assert.equal(await failureOf(createStack(repo, 't', [7], transport({ status: 404, json: null }))), 'notFound');
  });
});

describe('listStacks and addToStack', () => {
  it('lists the stacks with whether they are open and their pull requests, bottom first', async () => {
    const t = transport({ status: 200, json: [{ number: 4, open: false, pull_requests: [{ number: 1 }, { number: 2 }] }, { number: 9, open: true, pull_requests: [{ number: 7 }] }] });
    assert.deepEqual(await listStacks(repo, 't', t), [
      { number: 4, url: '', open: false, pullRequests: [1, 2] },
      { number: 9, url: '', open: true, pullRequests: [7] },
    ]);
    assert.equal(t.calls[0].url, 'https://api.github.com/repos/octo/app/stacks?per_page=100');
    assert.deepEqual(t.calls[0].headers, { 'X-GitHub-Api-Version': '2026-03-10' });
  });

  it('adds pull requests to the top of a stack', async () => {
    const t = transport({ status: 200, json: { number: 9, open: true, pull_requests: [{ number: 7 }, { number: 8 }] } });
    assert.deepEqual((await addToStack(repo, 't', 9, [8], t)).pullRequests, [7, 8]);
    assert.deepEqual([t.calls[0].method, t.calls[0].url, t.calls[0].body], ['POST', 'https://api.github.com/repos/octo/app/stacks/9/add', { pull_requests: [8] }]);
  });

  it('reports a conflict while someone else changes the stack', async () => {
    assert.equal(await failureOf(addToStack(repo, 't', 9, [8], transport({ status: 409, json: { message: 'busy' } }))), 'conflict');
  });
});
