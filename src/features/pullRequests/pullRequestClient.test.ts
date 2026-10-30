import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { fetchPullRequestLists, graphqlUrl, PullRequestError, type PullRequestTransport } from './pullRequestClient';

const repo = { host: 'github.com', owner: 'octo', repo: 'app' };
const pull = { number: 3, title: 'A change', url: 'https://github.com/octo/app/pull/3', headRefName: 'a', baseRefName: 'main', author: { login: 'ada' } };
const transport = (answer: { status: number; json: unknown } | Error): PullRequestTransport & { calls: { url: string; body: string; token: string }[] } => {
  const calls: { url: string; body: string; token: string }[] = [];
  return {
    calls,
    async post(url, body, token) {
      calls.push({ url, body, token });
      if (answer instanceof Error) {
        throw answer;
      }
      return answer;
    },
  };
};
const failureOf = async (answer: { status: number; json: unknown } | Error) =>
  fetchPullRequestLists(repo, 't', transport(answer)).then(
    () => 'no failure',
    (error: unknown) => (error instanceof PullRequestError ? error.failure : String(error)),
  );

describe('graphqlUrl', () => {
  it('uses the API address of github.com and the /api path of other hosts', () => {
    assert.equal(graphqlUrl(repo), 'https://api.github.com/graphql');
    assert.equal(graphqlUrl({ ...repo, host: 'github.example.ghe.com' }), 'https://github.example.ghe.com/api/graphql');
  });
});

describe('fetchPullRequestLists', () => {
  it('asks once, with the sign-in as the bearer token, and gives the three lists', async () => {
    const t = transport({ status: 200, json: { data: { createdByMe: { nodes: [pull] }, reviewRequested: { nodes: [] }, allOpen: { nodes: [pull, { ...pull, number: 4 }] } } } });
    const lists = await fetchPullRequestLists(repo, 'secret', t);
    assert.deepEqual(lists.allOpen.map((entry) => entry.number), [3, 4]);
    assert.equal(lists.createdByMe[0].author, 'ada');
    assert.equal(t.calls.length, 1);
    assert.equal(t.calls[0].url, 'https://api.github.com/graphql');
    assert.equal(t.calls[0].token, 'secret');
    assert.match(JSON.parse(t.calls[0].body).variables.createdByMe, /repo:octo\/app .*author:@me/);
    assert.doesNotMatch(t.calls[0].body, /secret/, 'the token goes in a header and nowhere in the body');
  });

  it('says what went wrong in terms a person can act on', async () => {
    assert.equal(await failureOf({ status: 401, json: { message: 'Bad credentials' } }), 'unauthorized');
    assert.equal(await failureOf({ status: 403, json: {} }), 'rateLimited');
    assert.equal(await failureOf({ status: 429, json: null }), 'rateLimited');
    assert.equal(await failureOf({ status: 200, json: { errors: [{ message: 'API rate limit exceeded for user' }] } }), 'rateLimited');
    assert.equal(await failureOf({ status: 200, json: { errors: [{ message: 'The listed users and repositories cannot be searched either because the resources do not exist or you do not have permission to view them.' }] } }), 'needsAccess');
    assert.equal(await failureOf({ status: 200, json: { errors: [{ message: 'Could not resolve to a Repository with the name octo/app' }] } }), 'needsAccess');
    assert.equal(await failureOf({ status: 500, json: null }), 'other');
    assert.equal(await failureOf({ status: 200, json: { data: null, errors: [{ message: 'Something odd' }] } }), 'other');
    assert.equal(await failureOf(new Error('getaddrinfo ENOTFOUND api.github.com')), 'network');
  });

  it('carries the error text of GitHub along', async () => {
    const error = await fetchPullRequestLists(repo, 't', transport({ status: 200, json: { errors: [{ message: 'Something odd' }] } })).then(
      () => undefined,
      (e: unknown) => e as Error,
    );
    assert.match(error?.message ?? '', /Something odd/);
  });
});
