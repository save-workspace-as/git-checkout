import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import type { PullRequestDto } from './pullRequests';
import type { PullRequestChain } from './pullRequestStacks';
import { locateLayer, moveInStack } from './stackNavigation';

const pull = (number: number, headRef: string): PullRequestDto => ({
  number, title: `Change ${number}`, author: 'ada', isDraft: false, headRef, headRepository: 'octo/app', baseRef: 'main',
  reviewDecision: null, checks: null, mergeable: 'mergeable', updatedAt: '', url: '',
});
const chain: PullRequestChain = { base: 'main', pulls: [pull(1, 'a'), pull(2, 'b'), pull(3, 'c')] };
const other: PullRequestChain = { base: 'dev', pulls: [pull(7, 'x'), pull(8, 'y')] };

describe('locateLayer', () => {
  it('finds a branch by the pull request it is from, or by the pr/<n> branch the pull request was checked out to', () => {
    assert.deepEqual(locateLayer([chain, other], 'b'), { chain, index: 1 });
    assert.deepEqual(locateLayer([chain, other], 'pr/8'), { chain: other, index: 1 });
  });

  it('has nothing for a branch that is in no stack', () => {
    assert.equal(locateLayer([chain, other], 'main'), undefined);
    assert.equal(locateLayer([], 'a'), undefined);
  });
});

describe('moveInStack', () => {
  const to = (index: number, move: Parameters<typeof moveInStack>[2]) => moveInStack(chain, index, move)?.number;

  it('goes one layer up or down, and to either end', () => {
    assert.equal(to(1, 'up'), 3);
    assert.equal(to(1, 'down'), 1);
    assert.equal(to(0, 'top'), 3);
    assert.equal(to(2, 'bottom'), 1);
  });

  it('does not move past an end, or to where it already is', () => {
    assert.equal(to(2, 'up'), undefined);
    assert.equal(to(0, 'down'), undefined);
    assert.equal(to(2, 'top'), undefined);
    assert.equal(to(0, 'bottom'), undefined);
  });
});
