import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import type { PullRequestState } from '../features/pullRequests/PullRequestStore';
import type { PullRequestDto } from '../shared/pullRequests/pullRequests';
import { PULL_REQUEST_COMMANDS, pullRequestNode, pullRequestSection } from './pullRequestNodes';
import { buildSidebarTree, treeItemSpec, withSidebarSearch } from './sidebarTreeModel';

const repo = { host: 'github.com', owner: 'octo', repo: 'app' };
const pull = (number: number, over: Partial<PullRequestDto> = {}): PullRequestDto => ({
  number, title: `Change ${number}`, author: 'ada', isDraft: false, headRef: `branch-${number}`, headRepository: 'octo/app', baseRef: 'main',
  reviewDecision: null, checks: null, mergeable: 'mergeable', updatedAt: '2026-10-30T10:00:00Z', url: `https://github.com/octo/app/pull/${number}`, ...over,
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
    assert.deepEqual(labels({ kind: 'idle' }), ['Loading…']);
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

  it('shows pull requests that build on one another as a stack, bottom first, with their place in it', () => {
    const open = [pull(3, { headRef: 'c', baseRef: 'b' }), pull(1, { headRef: 'a' }), pull(2, { headRef: 'b', baseRef: 'a' }), pull(9)];
    const section = pullRequestSection(ready({ allOpen: open }))!;
    assert.deepEqual(section.children.map((child) => child.label), ['Stacks', 'All open']);
    const stacks = section.children[0];
    assert.equal(stacks.description, '1');
    assert.equal(treeItemSpec(stacks).collapsible, 'expanded');
    const [stack] = stacks.children;
    assert.deepEqual([stack.label, stack.description, treeItemSpec(stack).collapsible], ['c', '3 pull requests into main', 'expanded']);
    assert.deepEqual(stack.children.map((row) => [row.ref, row.description]), [
      ['1', '1 of 3 · #1 by ada'],
      ['2', '2 of 3 · #2 by ada'],
      ['3', '3 of 3 · #3 by ada'],
    ]);
    const ids: string[] = [];
    const collect = (node: { id: string; children: unknown[] }): void => { ids.push(node.id); (node.children as typeof node[]).forEach(collect); };
    collect(section);
    assert.equal(new Set(ids).size, ids.length, 'every row has an id of its own, though a pull request is in more than one place');
  });

  it('has no Stacks folder when no pull requests build on one another', () => {
    const section = pullRequestSection(ready({ allOpen: [pull(1), pull(2)] }))!;
    assert.deepEqual(section.children.map((child) => child.label), ['All open']);
  });

  it('groups what needs you by the next step, leaves out empty groups, and keeps All open to browse', () => {
    const section = pullRequestSection(
      ready({
        createdByMe: [pull(1), pull(2, { checks: 'failure' }), pull(3, { reviewDecision: 'CHANGES_REQUESTED' }), pull(4, { reviewDecision: 'REVIEW_REQUIRED' })],
        reviewRequested: [pull(5, { author: 'bob' })],
        allOpen: [pull(1), pull(2), pull(3), pull(4), pull(5), pull(6)],
      }),
    )!;
    assert.equal(section.label, 'Pull Requests');
    assert.equal(section.description, '6');
    assert.deepEqual(section.children.map((child) => [child.label, child.description, treeItemSpec(child).collapsible]), [
      ['Ready to merge', '1', 'expanded'],
      ['Blocked', '1', 'expanded'],
      ['Requires follow-up', '1', 'expanded'],
      ['Needs your review', '1', 'expanded'],
      ['Waiting for review', '1', 'expanded'],
      ['All open', '6', 'collapsed'],
    ]);
    assert.deepEqual(section.children.map((child) => child.children.map((row) => row.ref)), [['1'], ['2'], ['3'], ['5'], ['4'], ['1', '2', '3', '4', '5', '6']]);
  });

  it('shows only All open when nothing involves you', () => {
    const section = pullRequestSection(ready({ allOpen: [pull(1)] }))!;
    assert.deepEqual(section.children.map((child) => child.label), ['All open']);
  });

  it('keeps the rows of one pull request in two groups apart', () => {
    const section = pullRequestSection(ready({ createdByMe: [pull(1)], allOpen: [pull(1)] }))!;
    const ids = section.children.flatMap((group) => group.children.map((child) => child.id));
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

  it('puts the section after Remotes, and leaves it out when there is none', () => {
    const labels = (section?: ReturnType<typeof pullRequestSection>) => buildSidebarTree(snapshot, [], [], [], section).map((node) => node.label);
    assert.deepEqual(labels(undefined), ['Branches', 'Remotes', 'Tags', 'Stashes', 'Worktrees', 'Submodules']);
    assert.deepEqual(labels(pullRequestSection(ready({}))), ['Branches', 'Remotes', 'Pull Requests', 'Tags', 'Stashes', 'Worktrees', 'Submodules']);
  });

  it('finds a pull request by its title, number or author in the sidebar search', () => {
    const tree = buildSidebarTree(snapshot, [], [], [], pullRequestSection(ready({ allOpen: [pull(5, { title: 'Speed up blame' }), pull(6, { author: 'grace' })] })));
    const found = (query: string) => withSidebarSearch(tree, query).filter((node) => node.label === 'Pull Requests').flatMap((node) => node.children.flatMap((category) => category.children.map((child) => child.ref)));
    assert.deepEqual(found('blame'), ['5']);
    assert.deepEqual(found('#6'), ['6']);
    assert.deepEqual(found('grace'), ['6']);
  });
});

describe('pullRequestNode checks', () => {
  it('carries how the checks stand to the row, and says it in the tooltip', () => {
    const failing = pullRequestNode(pull(1, { checks: 'failure' }), 'allOpen');
    assert.equal(treeItemSpec(failing).checks, 'failure');
    assert.match(failing.tooltip ?? '', /Checks failed/);
    assert.equal(treeItemSpec(pullRequestNode(pull(2), 'allOpen')).checks, undefined);
  });
});
