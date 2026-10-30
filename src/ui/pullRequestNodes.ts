import * as l10n from '@vscode/l10n';
import type { PullRequestState } from '../features/pullRequests/PullRequestStore';
import type { PullRequestCategory, PullRequestDto } from '../shared/pullRequests/pullRequests';
import { SIDEBAR_CONTEXT, type SidebarNode } from './sidebarTreeModel';

export const PULL_REQUEST_COMMANDS = {
  refresh: 'gitCheckout.pullRequests.refresh',
  signIn: 'gitCheckout.pullRequests.signIn',
  grantAccess: 'gitCheckout.pullRequests.grantAccess',
  checkout: 'gitCheckout.pullRequests.checkout',
  checkoutInWorktree: 'gitCheckout.pullRequests.checkoutInWorktree',
  openOnGitHub: 'gitCheckout.pullRequests.openOnGitHub',
  copyLink: 'gitCheckout.pullRequests.copyLink',
} as const;

const CATEGORIES: { key: PullRequestCategory; label: () => string; expandWhenNotEmpty: boolean }[] = [
  { key: 'createdByMe', label: () => l10n.t('Created by me'), expandWhenNotEmpty: true },
  { key: 'reviewRequested', label: () => l10n.t('Waiting for my review'), expandWhenNotEmpty: true },
  { key: 'allOpen', label: () => l10n.t('All open'), expandWhenNotEmpty: false },
];

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

export function pullRequestNode(pull: PullRequestDto, category: PullRequestCategory): SidebarNode {
  const details = [pull.author ? l10n.t('by {0}', pull.author) : '', pull.isDraft ? l10n.t('Draft') : ''].filter(Boolean).join(' · ');
  return {
    id: `pullRequest:${category}:${pull.number}`,
    kind: 'pullRequest',
    label: pull.title,
    description: `#${pull.number}${details ? ` ${details}` : ''}`,
    tooltip: [`#${pull.number} ${pull.title}`, `${pull.headRepository ? `${pull.headRepository}:` : ''}${pull.headRef} → ${pull.baseRef}`, decisionText(pull)]
      .filter(Boolean)
      .join('\n'),
    contextValue: SIDEBAR_CONTEXT.pullRequest,
    ref: String(pull.number),
    icon: iconOf(pull),
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
    case 'ready':
      return section(
        CATEGORIES.map(({ key, label, expandWhenNotEmpty }) => {
          const pulls = state.lists[key];
          return {
            id: `pullRequests:${key}`,
            kind: 'folder',
            label: label(),
            description: String(pulls.length),
            contextValue: SIDEBAR_CONTEXT.pullRequestCategory,
            icon: { id: key === 'createdByMe' ? 'account' : key === 'reviewRequested' ? 'eye' : 'list-flat' },
            expanded: expandWhenNotEmpty && pulls.length > 0,
            children: pulls.length > 0 ? pulls.map((pull) => pullRequestNode(pull, key)) : [message(`${key}:none`, l10n.t('No pull requests'))],
          } satisfies SidebarNode;
        }),
        String(state.lists.allOpen.length),
      );
  }
}
