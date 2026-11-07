import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import type { PullRequestDto } from './pullRequests';
import { pullRequestChains } from './pullRequestStacks';

const repo = { host: 'github.com', owner: 'octo', repo: 'app' };
const pull = (number: number, headRef: string, baseRef: string, over: Partial<PullRequestDto> = {}): PullRequestDto => ({
  number, title: `Change ${number}`, author: 'ada', isDraft: false, headRef, headRepository: 'octo/app', baseRef,
  reviewDecision: null, checks: null, mergeable: 'mergeable', updatedAt: '2026-10-30T10:00:00Z', url: `https://github.com/octo/app/pull/${number}`, ...over,
});
const numbers = (pulls: readonly PullRequestDto[]) => pullRequestChains(pulls, repo).map((chain) => [chain.base, chain.pulls.map((p) => p.number)]);

describe('pullRequestChains', () => {
  it('orders pull requests that build on one another from the bottom up, whatever order they come in', () => {
    const chain = [pull(3, 'c', 'b'), pull(1, 'a', 'main'), pull(2, 'b', 'a')];
    assert.deepEqual(numbers(chain), [['main', [1, 2, 3]]]);
  });

  it('leaves out pull requests that stand alone, and ones on a branch nobody has a pull request from', () => {
    assert.deepEqual(numbers([pull(1, 'a', 'main'), pull(2, 'b', 'main'), pull(3, 'c', 'release')]), []);
  });

  it('keeps separate stacks apart, the one changed most recently first', () => {
    const old = '2026-10-01T00:00:00Z';
    const pulls = [pull(1, 'a', 'main', { updatedAt: old }), pull(2, 'b', 'a', { updatedAt: old }), pull(5, 'x', 'dev'), pull(6, 'y', 'x')];
    assert.deepEqual(numbers(pulls), [['dev', [5, 6]], ['main', [1, 2]]]);
  });

  it('ends a chain where two pull requests build on one, and starts a chain from each of them', () => {
    const pulls = [pull(1, 'a', 'main'), pull(2, 'b', 'a'), pull(3, 'c', 'a'), pull(4, 'd', 'c')];
    assert.deepEqual(numbers(pulls), [['a', [3, 4]]]);
  });

  it('leaves out pull requests from forks, and ones whose repository is gone', () => {
    const pulls = [pull(1, 'a', 'main'), pull(2, 'b', 'a', { headRepository: 'someone/app' }), pull(3, 'c', 'a', { headRepository: null })];
    assert.deepEqual(numbers(pulls), []);
    assert.deepEqual(numbers([pull(1, 'a', 'main'), pull(2, 'b', 'a', { headRepository: 'OCTO/App' })]), [['main', [1, 2]]]);
  });

  it('does not loop on pull requests that point at each other', () => {
    assert.deepEqual(numbers([pull(1, 'a', 'b'), pull(2, 'b', 'a')]), []);
    assert.deepEqual(numbers([pull(1, 'a', 'a')]), []);
  });
});
