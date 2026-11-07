import * as l10n from '@vscode/l10n';
import type { PullRequestState } from '../features/pullRequests/PullRequestStore';
import { pullRequestChains } from '../shared/pullRequests/pullRequestStacks';
import { groupPullRequests, PULL_REQUEST_GROUPS, type PullRequestCategory, type PullRequestDto, type PullRequestGroup } from '../shared/pullRequests/pullRequests';
import { SIDEBAR_CONTEXT, type SidebarNode } from './sidebarTreeModel';

export const PULL_REQUEST_COMMANDS = {
  refresh: 'gitCheckout.pullRequests.refresh',
  signIn: 'gitCheckout.pullRequests.signIn',
  grantAccess: 'gitCheckout.pullRequests.grantAccess',
  checkout: 'gitCheckout.pullRequests.checkout',
  checkoutInWorktree: 'gitCheckout.pullRequests.checkoutInWorktree',
  review: 'gitCheckout.pullRequests.review',
  openOnGitHub: 'gitCheckout.pullRequests.openOnGitHub',
  copyLink: 'gitCheckout.pullRequests.copyLink',
  createStack: 'gitCheckout.pullRequests.createStack',
  checkoutStack: 'gitCheckout.pullRequests.checkoutStack',
  stackUp: 'gitCheckout.pullRequests.stackUp',
  stackDown: 'gitCheckout.pullRequests.stackDown',
  stackTop: 'gitCheckout.pullRequests.stackTop',
  stackBottom: 'gitCheckout.pullRequests.stackBottom',
  pushStack: 'gitCheckout.pullRequests.pushStack',
  rebaseStack: 'gitCheckout.pullRequests.rebaseStack',
} as const;

const GROUPS: Record<PullRequestGroup, { label: () => string; icon: string }> = {
  readyToMerge: { label: () => l10n.t('Ready to merge'), icon: 'git-merge' },
  blocked: { label: () => l10n.t('Blocked'), icon: 'error' },
  followUp: { label: () => l10n.t('Requires follow-up'), icon: 'comment-discussion' },
  needsReview: { label: () => l10n.t('Needs your review'), icon: 'eye' },
  waitingForReview: { label: () => l10n.t('Waiting for review'), icon: 'watch' },
  draft: { label: () => l10n.t('Draft'), icon: 'git-pull-request-draft' },
};

const message = (id: string, label: string, tooltip?: string): SidebarNode => ({
  id: `message:pullRequests:${id}`,
  kind: 'message',
  label,
  tooltip,
  contextValue: SIDEBAR_CONTEXT.message,
  icon: { id: 'info' },
  children: [],
});

const action = (id: string, label: string, command: string, tooltip: string): SidebarNode => ({
  id: `action:pullRequests:${id}`,
  kind: 'message',
  label,
  tooltip,
  contextValue: SIDEBAR_CONTEXT.pullRequestAction,
  icon: { id: 'github' },
  command: { id: command },
  children: [],
});

/** What a reviewer's decision looks like on the row: the pull request icon takes its color. */
function iconOf(pull: PullRequestDto): { id: string; color?: string } {
  if (pull.isDraft) {
    return { id: 'git-pull-request-draft', color: 'disabledForeground' };
  }
  switch (pull.reviewDecision) {
    case 'APPROVED':
      return { id: 'git-pull-request', color: 'charts.green' };
    case 'CHANGES_REQUESTED':
      return { id: 'git-pull-request', color: 'charts.red' };
    default:
      return { id: 'git-pull-request' };
  }
}

function decisionText(pull: PullRequestDto): string {
  switch (pull.reviewDecision) {
    case 'APPROVED':
      return l10n.t('Approved');
    case 'CHANGES_REQUESTED':
      return l10n.t('Changes requested');
    case 'REVIEW_REQUIRED':
      return l10n.t('Review required');
    default:
      return '';
  }
}

function checksText(pull: PullRequestDto): string {
  switch (pull.checks) {
    case 'success':
      return l10n.t('Checks passed');
    case 'failure':
      return l10n.t('Checks failed');
    case 'pending':
      return l10n.t('Checks pending');
    default:
      return '';
  }
}

/** `position` is where the pull request is in its stack, counting from the bottom at 1. */
export function pullRequestNode(pull: PullRequestDto, category: PullRequestCategory, position?: { index: number; count: number }): SidebarNode {
  const details = [pull.author ? l10n.t('by {0}', pull.author) : '', pull.isDraft ? l10n.t('Draft') : ''].filter(Boolean).join(' · ');
  const place = position ? `${l10n.t('{0} of {1}', position.index, position.count)} · ` : '';
  return {
    id: `pullRequest:${category}:${pull.number}`,
    kind: 'pullRequest',
    label: pull.title,
    description: `${place}#${pull.number}${details ? ` ${details}` : ''}`,
    tooltip: [`#${pull.number} ${pull.title}`, `${pull.headRepository ? `${pull.headRepository}:` : ''}${pull.headRef} → ${pull.baseRef}`, decisionText(pull), checksText(pull)]
      .filter(Boolean)
      .join('\n'),
    contextValue: SIDEBAR_CONTEXT.pullRequest,
    ref: String(pull.number),
    icon: iconOf(pull),
    checks: pull.checks ?? undefined,
    children: [],
  };
}

/** The Pull Requests section for a repository, or undefined when there is nothing to show: it is off, or the repository is not on GitHub. */
export function pullRequestSection(state: PullRequestState): SidebarNode | undefined {
  if (state.kind === 'hidden') {
    return undefined;
  }
  const section = (children: SidebarNode[], description?: string): SidebarNode => ({
    id: 'section:pullRequests',
    kind: 'section',
    label: l10n.t('Pull Requests'),
    contextValue: SIDEBAR_CONTEXT.pullRequestsSection,
    description,
    children,
  });
  switch (state.kind) {
    case 'idle':
    case 'loading':
      return section([{ ...message('loading', l10n.t('Loading…')), icon: { id: 'loading~spin' } }]);
    case 'signedOut':
      return section([action('signIn', l10n.t('Sign in to GitHub'), PULL_REQUEST_COMMANDS.signIn, l10n.t('Sign in with VS Code to list the pull requests of this repository.'))]);
    case 'needsAccess':
      return section([
        action('access', l10n.t('Allow access to private repositories'), PULL_REQUEST_COMMANDS.grantAccess, l10n.t('This repository is private. Sign in again and allow GitHub to share it to list its pull requests.')),
      ]);
    case 'error':
      return section([
        { ...message('error', l10n.t('Could not load pull requests'), state.message), icon: { id: 'warning' } },
        action('retry', l10n.t('Try again'), PULL_REQUEST_COMMANDS.refresh, l10n.t('Read the pull requests again.')),
      ]);
    case 'ready': {
      const groups = groupPullRequests(state.lists);
      const folder = (key: PullRequestCategory, label: string, icon: string, pulls: PullRequestDto[], expanded: boolean): SidebarNode => ({
        id: `pullRequests:${key}`,
        kind: 'folder',
        label,
        description: String(pulls.length),
        contextValue: SIDEBAR_CONTEXT.pullRequestCategory,
        icon: { id: icon },
        expanded,
        children: pulls.map((pull) => pullRequestNode(pull, key)),
      });
      const chains = pullRequestChains(state.lists.allOpen, state.repo);
      const stacks: SidebarNode | undefined = chains.length === 0 ? undefined : {
        id: 'pullRequests:stacks',
        kind: 'folder',
        label: l10n.t('Stacks'),
        description: String(chains.length),
        contextValue: SIDEBAR_CONTEXT.pullRequestCategory,
        icon: { id: 'layers' },
        expanded: true,
        children: chains.map((chain): SidebarNode => {
          const category: PullRequestCategory = `stack-${chain.pulls[0].number}`;
          const top = chain.pulls[chain.pulls.length - 1];
          return {
            id: `pullRequests:${category}`,
            kind: 'folder',
            label: top.headRef,
            description: l10n.t('{0} pull requests into {1}', chain.pulls.length, chain.base),
            contextValue: SIDEBAR_CONTEXT.pullRequestStack,
            ref: String(chain.pulls[0].number),
            icon: { id: 'layers' },
            expanded: true,
            children: chain.pulls.map((pull, index) => pullRequestNode(pull, category, { index: index + 1, count: chain.pulls.length })),
          };
        }),
      };
      // A group with nothing in it is left out; All open stays, as the place to browse.
      return section(
        [
          ...PULL_REQUEST_GROUPS.filter((group) => groups[group].length > 0).map((group) =>
            folder(group, GROUPS[group].label(), GROUPS[group].icon, groups[group], true),
          ),
          ...(stacks ? [stacks] : []),
          folder('allOpen', l10n.t('All open'), 'list-flat', state.lists.allOpen, false),
        ],
        String(state.lists.allOpen.length),
      );
    }
  }
}
