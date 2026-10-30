import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import type { PullRequestState } from '../features/pullRequests/PullRequestStore';
import type { PullRequestDto } from '../shared/pullRequests/pullRequests';
import { PULL_REQUEST_COMMANDS, pullRequestNode, pullRequestSection } from './pullRequestNodes';
import { buildSidebarTree, treeItemSpec, withSidebarSearch } from './sidebarTreeModel';

const repo = { host: 'github.com', owner: 'octo', repo: 'app' };
const pull = (number: number, over: Partial<PullRequestDto> = {}): PullRequestDto => ({
  number, title: `Change ${number}`, author: 'ada', isDraft: false, headRef: `branch-${number}`, headRepository: 'octo/app', baseRef: 'main',
  reviewDecision: null, updatedAt: '2026-10-30T10:00:00Z', url: `https://github.com/octo/app/pull/${number}`, ...over,
});
const ready = (lists: Partial<Record<'createdByMe' | 'reviewRequested' | 'allOpen', PullRequestDto[]>>): PullRequestState => ({
  kind: 'ready', repo, remote: 'origin', lists: { createdByMe: [], reviewRequested: [], allOpen: [], ...lists },
});

describe('pullRequestSection', () => {
  it('has nothing when pull requests are off or the repository is not on GitHub', () => {
    assert.equal(pullRequestSection({ kind: 'hidden' }), undefined);
  });

  it('shows what is happening while the list is not there yet', () => {
    const labels = (state: PullRequestState) => pullRequestSection(state)!.children.map((child) => child.label);
    assert.deepEqual(labels({ kind: 'loading' }), ['Loading…']);
    assert.deepEqual(labels({ kind: 'signedOut' }), ['Sign in to GitHub']);
    assert.deepEqual(labels({ kind: 'needsAccess' }), ['Allow access to private repositories']);
    assert.deepEqual(labels({ kind: 'error', message: 'boom' }), ['Could not load pull requests', 'Try again']);
  });

  it('gives the sign-in and retry rows the command that does it when clicked', () => {
    const commandOf = (state: PullRequestState, index = 0) => treeItemSpec(pullRequestSection(state)!.children[index]).command?.id;
    assert.equal(commandOf({ kind: 'signedOut' }), PULL_REQUEST_COMMANDS.signIn);
    assert.equal(commandOf({ kind: 'needsAccess' }), PULL_REQUEST_COMMANDS.grantAccess);
    assert.equal(commandOf({ kind: 'error', message: 'x' }, 1), PULL_REQUEST_COMMANDS.refresh);
    assert.equal(commandOf({ kind: 'loading' }), undefined);
  });

  it('lists the three categories, open the ones with something in them, and count them', () => {
    const section = pullRequestSection(ready({ createdByMe: [pull(1)], allOpen: [pull(1), pull(2), pull(3)] }))!;
    assert.equal(section.label, 'Pull Requests');
    assert.equal(section.description, '3');
    assert.deepEqual(section.children.map((child) => [child.label, child.description, treeItemSpec(child).collapsible]), [
      ['Created by me', '1', 'expanded'],
      ['Waiting for my review', '0', 'collapsed'],
      ['All open', '3', 'collapsed'],
    ]);
    assert.deepEqual(section.children[1].children.map((child) => child.label), ['No pull requests']);
    assert.deepEqual(section.children[2].children.map((child) => child.ref), ['1', '2', '3']);
  });

  it('keeps the rows of one pull request in two categories apart', () => {
    const section = pullRequestSection(ready({ createdByMe: [pull(1)], allOpen: [pull(1)] }))!;
    const ids = section.children.flatMap((category) => category.children.map((child) => child.id));
    assert.equal(new Set(ids).size, ids.length);
  });
});

describe('pullRequestNode', () => {
  it('shows the title, the number and who opened it, with the branches on hover', () => {
    const node = pullRequestNode(pull(7, { author: 'ada', headRepository: 'fork/app', headRef: 'fix' }), 'allOpen');
    assert.equal(node.label, 'Change 7');
    assert.equal(node.description, '#7 by ada');
    assert.equal(node.ref, '7');
    assert.equal(node.contextValue, 'pullRequest');
    assert.match(node.tooltip ?? '', /fork\/app:fix → main/);
  });

  it('marks a draft, and colors the icon by what the reviewers decided', () => {
    assert.equal(pullRequestNode(pull(1, { isDraft: true }), 'allOpen').description, '#1 by ada · Draft');
    assert.deepEqual(pullRequestNode(pull(1, { isDraft: true }), 'allOpen').icon, { id: 'git-pull-request-draft', color: 'disabledForeground' });
    assert.deepEqual(pullRequestNode(pull(1, { reviewDecision: 'APPROVED' }), 'allOpen').icon, { id: 'git-pull-request', color: 'charts.green' });
    assert.deepEqual(pullRequestNode(pull(1, { reviewDecision: 'CHANGES_REQUESTED' }), 'allOpen').icon, { id: 'git-pull-request', color: 'charts.red' });
    assert.deepEqual(pullRequestNode(pull(1), 'allOpen').icon, { id: 'git-pull-request' });
    assert.match(pullRequestNode(pull(1, { reviewDecision: 'APPROVED' }), 'allOpen').tooltip ?? '', /Approved/);
  });

  it('copes with a pull request whose author is gone', () => {
    assert.equal(pullRequestNode(pull(2, { author: '' }), 'allOpen').description, '#2');
  });
});

describe('the sidebar with pull requests', () => {
  const snapshot = { branches: [], remotes: [], remoteBranches: [], tags: [], headRef: null } as never;
  const worktree = { stagedCount: 0, unstagedCount: 0 } as never;

  it('puts the section after Remotes, and leaves it out when there is none', () => {
    const labels = (section?: ReturnType<typeof pullRequestSection>) => buildSidebarTree(snapshot, worktree, [], [], [], section).map((node) => node.label);
    assert.deepEqual(labels(undefined), ['Changes', 'History', 'Branches', 'Remotes', 'Tags', 'Stashes', 'Worktrees', 'Submodules']);
    assert.deepEqual(labels(pullRequestSection(ready({}))), ['Changes', 'History', 'Branches', 'Remotes', 'Pull Requests', 'Tags', 'Stashes', 'Worktrees', 'Submodules']);
  });

  it('finds a pull request by its title, number or author in the sidebar search', () => {
    const tree = buildSidebarTree(snapshot, worktree, [], [], [], pullRequestSection(ready({ allOpen: [pull(5, { title: 'Speed up blame' }), pull(6, { author: 'grace' })] })));
    const found = (query: string) => withSidebarSearch(tree, query).filter((node) => node.label === 'Pull Requests').flatMap((node) => node.children.flatMap((category) => category.children.map((child) => child.ref)));
    assert.deepEqual(found('blame'), ['5']);
    assert.deepEqual(found('#6'), ['6']);
    assert.deepEqual(found('grace'), ['6']);
  });
});
