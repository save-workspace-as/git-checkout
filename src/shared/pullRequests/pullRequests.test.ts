import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { groupOf, groupPullRequests, isFromFork, parsePullRequestLists, pullRequestBranch, pullRequestsQuery } from './pullRequests';

const repo = { host: 'github.com', owner: 'octo', repo: 'app' };
const node = (over: Record<string, unknown> = {}) => ({
  number: 12, title: 'Fix it', url: 'https://github.com/octo/app/pull/12', isDraft: false, updatedAt: '2026-10-30T10:00:00Z',
  headRefName: 'fix-it', baseRefName: 'main', reviewDecision: 'APPROVED', mergeable: 'MERGEABLE', commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] }, author: { login: 'ada' }, headRepository: { nameWithOwner: 'octo/app' }, ...over,
});

describe('pullRequestsQuery', () => {
  it('searches this repository for open pull requests, three ways', () => {
    const { query, variables } = pullRequestsQuery(repo);
    assert.deepEqual(variables, {
      createdByMe: 'repo:octo/app is:pr is:open sort:updated-desc author:@me',
      reviewRequested: 'repo:octo/app is:pr is:open sort:updated-desc review-requested:@me',
      allOpen: 'repo:octo/app is:pr is:open sort:updated-desc',
    });
    for (const name of ['createdByMe', 'reviewRequested', 'allOpen']) {
      assert.match(query, new RegExp(`${name}: search\\(query: \\$${name}`));
    }
  });

  it('passes the repository only as a search variable, never into the query text', () => {
    const evil = { host: 'github.com', owner: 'a", x: "', repo: 'b' };
    assert.equal(pullRequestsQuery(evil).query.includes('a"'), false);
  });
});

describe('parsePullRequestLists', () => {
  it('reads the three lists', () => {
    const lists = parsePullRequestLists({ data: { createdByMe: { nodes: [node()] }, reviewRequested: { nodes: [] }, allOpen: { nodes: [node(), node({ number: 13 })] } } });
    assert.equal(lists?.createdByMe.length, 1);
    assert.equal(lists?.reviewRequested.length, 0);
    assert.deepEqual(lists?.allOpen.map((pull) => pull.number), [12, 13]);
    assert.deepEqual(lists?.createdByMe[0], {
      number: 12, title: 'Fix it', author: 'ada', isDraft: false, headRef: 'fix-it', headRepository: 'octo/app', baseRef: 'main',
      reviewDecision: 'APPROVED', checks: 'success', mergeable: 'mergeable', updatedAt: '2026-10-30T10:00:00Z', url: 'https://github.com/octo/app/pull/12',
    });
  });

  it('reads whether it merges cleanly, and takes anything else as unknown', () => {
    const mergeable = (value: unknown) => parsePullRequestLists({ data: { createdByMe: { nodes: [node({ mergeable: value })] } } })?.createdByMe[0].mergeable;
    assert.equal(mergeable('CONFLICTING'), 'conflicting');
    assert.equal(mergeable('UNKNOWN'), 'unknown');
    assert.equal(mergeable(undefined), 'unknown');
  });

  it('copes with a deleted author or fork, and drops what is not a pull request', () => {
    const lists = parsePullRequestLists({ data: { createdByMe: { nodes: [node({ author: null, headRepository: null, reviewDecision: null }), {}, null, { number: 1 }, { __typename: 'Issue' }] }, reviewRequested: null, allOpen: {} } });
    assert.equal(lists?.createdByMe.length, 1);
    assert.equal(lists?.createdByMe[0].author, '');
    assert.equal(lists?.createdByMe[0].headRepository, null);
    assert.deepEqual(lists?.reviewRequested, []);
    assert.deepEqual(lists?.allOpen, []);
  });

  it('gives nothing for an answer of another shape', () => {
    assert.equal(parsePullRequestLists(null), undefined);
    assert.equal(parsePullRequestLists({ errors: [{ message: 'bad' }] }), undefined);
    assert.equal(parsePullRequestLists('text'), undefined);
  });
});

describe('pull request branch and forks', () => {
  it('names the local branch by number', () => assert.equal(pullRequestBranch(42), 'pr/42'));
  it('knows a pull request from a fork', () => {
    const pull = parsePullRequestLists({ data: { allOpen: { nodes: [node(), node({ headRepository: { nameWithOwner: 'Someone/app' } }), node({ headRepository: null })] } } })!.allOpen;
    assert.deepEqual(pull.map((entry) => isFromFork(entry, repo)), [false, true, false]);
    assert.equal(isFromFork({ ...pull[0], headRepository: 'OCTO/App' }, repo), false, 'names compare without regard to case');
  });
});

describe('groupOf', () => {
  const base = { number: 1, title: 't', author: 'ada', isDraft: false, headRef: 'h', headRepository: 'octo/app', baseRef: 'main', reviewDecision: null, checks: null, mergeable: 'mergeable', updatedAt: '2026-10-30T10:00:00Z', url: 'u' } as const;
  const group = (over: Partial<Parameters<typeof groupOf>[0]>, mine = true) => groupOf({ ...base, ...over }, mine);

  it('puts a draft in Draft, mine or not', () => {
    assert.equal(group({ isDraft: true }), 'draft');
    assert.equal(group({ isDraft: true, checks: 'failure' }, false), 'draft');
  });

  it('asks you to review what someone else opened', () => {
    assert.equal(group({ reviewDecision: 'REVIEW_REQUIRED' }, false), 'needsReview');
  });

  it('blocks your pull request for conflicts or failed checks, before anything else', () => {
    assert.equal(group({ mergeable: 'conflicting', reviewDecision: 'APPROVED' }), 'blocked');
    assert.equal(group({ checks: 'failure', reviewDecision: 'CHANGES_REQUESTED' }), 'blocked');
  });

  it('asks for a follow-up when a reviewer requested changes', () => {
    assert.equal(group({ reviewDecision: 'CHANGES_REQUESTED', checks: 'success' }), 'followUp');
  });

  it('is ready to merge when approved, or needing no review, and the checks are not running', () => {
    assert.equal(group({ reviewDecision: 'APPROVED', checks: 'success' }), 'readyToMerge');
    assert.equal(group({ reviewDecision: null, checks: null }), 'readyToMerge');
    assert.equal(group({ reviewDecision: null, mergeable: 'unknown' }), 'readyToMerge');
  });

  it('waits for reviewers, or for checks that are still running', () => {
    assert.equal(group({ reviewDecision: 'REVIEW_REQUIRED' }), 'waitingForReview');
    assert.equal(group({ reviewDecision: 'APPROVED', checks: 'pending' }), 'waitingForReview');
  });
});

describe('groupPullRequests', () => {
  const make = (number: number, updatedAt: string, over: object = {}) =>
    ({ number, title: 't', author: 'ada', isDraft: false, headRef: 'h', headRepository: null, baseRef: 'main', reviewDecision: null, checks: null, mergeable: 'mergeable', updatedAt, url: 'u', ...over }) as const;

  it('lists each pull request once, newest change first, with the ones you opened treated as yours', () => {
    const groups = groupPullRequests({
      createdByMe: [make(1, '2026-10-01T00:00:00Z'), make(2, '2026-10-03T00:00:00Z')],
      reviewRequested: [make(2, '2026-10-03T00:00:00Z'), make(3, '2026-10-02T00:00:00Z')],
      allOpen: [],
    });
    assert.deepEqual(groups.readyToMerge.map((pull) => pull.number), [2, 1]);
    assert.deepEqual(groups.needsReview.map((pull) => pull.number), [3]);
    assert.deepEqual(groups.blocked, []);
  });
});
