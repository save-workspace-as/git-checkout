import type { GitHubRepository } from '../history/githubReferences';

export type PullRequestChecks = 'success' | 'failure' | 'pending';

/** Whether the change merges cleanly into its base, as GitHub last worked it out. */
export type PullRequestMergeable = 'mergeable' | 'conflicting' | 'unknown';

/** An open pull request, as the sidebar lists it. */
export interface PullRequestDto {
  number: number;
  title: string;
  /** The login of whoever opened it. */
  author: string;
  isDraft: boolean;
  /** The branch the change is on, and the repository it lives in (a fork differs from the base). */
  headRef: string;
  headRepository: string | null;
  baseRef: string;
  /** What reviewers decided: `APPROVED`, `CHANGES_REQUESTED` or `REVIEW_REQUIRED`, when the repository asks for reviews. */
  reviewDecision: string | null;
  /** How the checks on the latest commit stand, when it has any. */
  checks: PullRequestChecks | null;
  mergeable: PullRequestMergeable;
  /** ISO time of the last change. */
  updatedAt: string;
  url: string;
}

/** The three searches behind the sidebar, newest change first. */
export interface PullRequestLists {
  createdByMe: PullRequestDto[];
  reviewRequested: PullRequestDto[];
  allOpen: PullRequestDto[];
}

export type PullRequestCategory = keyof PullRequestLists | PullRequestGroup;

export const PULL_REQUESTS_PER_LIST = 50;

const FIELDS = `
  ... on PullRequest {
    number title url isDraft updatedAt headRefName baseRefName reviewDecision mergeable
    author { login }
    headRepository { nameWithOwner }
    commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
  }`;

/** One GraphQL request for all three lists: the search syntax `@me` is the signed-in user. */
export function pullRequestsQuery(repo: GitHubRepository): { query: string; variables: Record<string, string> } {
  const scope = `repo:${repo.owner}/${repo.repo} is:pr is:open sort:updated-desc`;
  const list = (name: string): string =>
    `${name}: search(query: $${name}, type: ISSUE, first: ${PULL_REQUESTS_PER_LIST}) { nodes { ${FIELDS} } }`;
  return {
    query: `query($createdByMe: String!, $reviewRequested: String!, $allOpen: String!) {
      ${list('createdByMe')}
      ${list('reviewRequested')}
      ${list('allOpen')}
    }`,
    variables: {
      createdByMe: `${scope} author:@me`,
      reviewRequested: `${scope} review-requested:@me`,
      allOpen: scope,
    },
  };
}

/** GitHub's rollup states folded into the three a row can show; no checks at all is null. */
export function checksFrom(state: unknown): PullRequestChecks | null {
  switch (state) {
    case 'SUCCESS':
      return 'success';
    case 'FAILURE':
    case 'ERROR':
      return 'failure';
    case 'PENDING':
    case 'EXPECTED':
      return 'pending';
    default:
      return null;
  }
}

function pullRequestFrom(node: unknown): PullRequestDto | undefined {
  const value = node as Record<string, unknown> | null;
  if (!value || typeof value.number !== 'number' || typeof value.title !== 'string' || typeof value.url !== 'string') {
    return undefined;
  }
  const author = (value.author as { login?: unknown } | null)?.login;
  const head = (value.headRepository as { nameWithOwner?: unknown } | null)?.nameWithOwner;
  const commits = (value.commits as { nodes?: { commit?: { statusCheckRollup?: { state?: unknown } | null } }[] } | null)?.nodes;
  return {
    number: value.number,
    title: value.title,
    author: typeof author === 'string' ? author : '',
    isDraft: value.isDraft === true,
    headRef: typeof value.headRefName === 'string' ? value.headRefName : '',
    headRepository: typeof head === 'string' ? head : null,
    baseRef: typeof value.baseRefName === 'string' ? value.baseRefName : '',
    reviewDecision: typeof value.reviewDecision === 'string' ? value.reviewDecision : null,
    checks: checksFrom(commits?.[0]?.commit?.statusCheckRollup?.state),
    mergeable: value.mergeable === 'MERGEABLE' ? 'mergeable' : value.mergeable === 'CONFLICTING' ? 'conflicting' : 'unknown',
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : '',
    url: value.url,
  };
}

/**
 * Reads the answer to {@link pullRequestsQuery}. Entries that are not pull requests, or lack a number, a title or an
 * address, are left out. Undefined when the answer is not the shape the query asks for.
 */
export function parsePullRequestLists(body: unknown): PullRequestLists | undefined {
  const data = (body as { data?: Record<string, { nodes?: unknown[] } | null> } | null)?.data;
  if (!data || typeof data !== 'object') {
    return undefined;
  }
  const read = (name: string): PullRequestDto[] =>
    (data[name]?.nodes ?? []).flatMap((node) => {
      const pull = pullRequestFrom(node);
      return pull ? [pull] : [];
    });
  return { createdByMe: read('createdByMe'), reviewRequested: read('reviewRequested'), allOpen: read('allOpen') };
}

/** What to do about a pull request, from the one that needs the most action down. */
export const PULL_REQUEST_GROUPS = ['readyToMerge', 'blocked', 'followUp', 'needsReview', 'waitingForReview', 'draft'] as const;
export type PullRequestGroup = (typeof PULL_REQUEST_GROUPS)[number];

/**
 * The group of a pull request. A draft is a draft. One that someone else opened and asked you to review needs your
 * review. Of your own, conflicts or failed checks block it, a reviewer's change request calls for a follow-up, and what
 * is approved (or needs no review) with its checks done is ready to merge; the rest waits for reviewers or checks.
 */
export function groupOf(pull: PullRequestDto, mine: boolean): PullRequestGroup {
  if (pull.isDraft) {
    return 'draft';
  }
  if (!mine) {
    return 'needsReview';
  }
  if (pull.mergeable === 'conflicting' || pull.checks === 'failure') {
    return 'blocked';
  }
  if (pull.reviewDecision === 'CHANGES_REQUESTED') {
    return 'followUp';
  }
  const decided = pull.reviewDecision === 'APPROVED' || pull.reviewDecision === null;
  return decided && pull.checks !== 'pending' ? 'readyToMerge' : 'waitingForReview';
}

/** Your pull requests and the ones you are asked to review, by what each needs next, newest change first. */
export function groupPullRequests(lists: PullRequestLists): Record<PullRequestGroup, PullRequestDto[]> {
  const groups: Record<PullRequestGroup, PullRequestDto[]> = {
    readyToMerge: [],
    blocked: [],
    followUp: [],
    needsReview: [],
    waitingForReview: [],
    draft: [],
  };
  const mine = new Set(lists.createdByMe.map((pull) => pull.number));
  const seen = new Set<number>();
  for (const pull of [...lists.createdByMe, ...lists.reviewRequested]) {
    if (!seen.has(pull.number)) {
      seen.add(pull.number);
      groups[groupOf(pull, mine.has(pull.number))].push(pull);
    }
  }
  for (const pulls of Object.values(groups)) {
    pulls.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  return groups;
}

/** The local branch a pull request is checked out to. */
export function pullRequestBranch(number: number): string {
  return `pr/${number}`;
}

/** Whether the pull request comes from another repository, such as a fork. */
export function isFromFork(pull: PullRequestDto, repo: GitHubRepository): boolean {
  return pull.headRepository !== null && pull.headRepository.toLowerCase() !== `${repo.owner}/${repo.repo}`.toLowerCase();
}
