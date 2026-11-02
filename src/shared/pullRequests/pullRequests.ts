import type { GitHubRepository } from '../history/githubReferences';

export type PullRequestChecks = 'success' | 'failure' | 'pending';

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
  /** ISO time of the last change. */
  updatedAt: string;
  url: string;
}

/** The three lists the sidebar shows, newest change first. */
export interface PullRequestLists {
  createdByMe: PullRequestDto[];
  reviewRequested: PullRequestDto[];
  allOpen: PullRequestDto[];
}

export type PullRequestCategory = keyof PullRequestLists;

export const PULL_REQUESTS_PER_LIST = 50;

const FIELDS = `
  ... on PullRequest {
    number title url isDraft updatedAt headRefName baseRefName reviewDecision
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

/** The local branch a pull request is checked out to. */
export function pullRequestBranch(number: number): string {
  return `pr/${number}`;
}

/** Whether the pull request comes from another repository, such as a fork. */
export function isFromFork(pull: PullRequestDto, repo: GitHubRepository): boolean {
  return pull.headRepository !== null && pull.headRepository.toLowerCase() !== `${repo.owner}/${repo.repo}`.toLowerCase();
}
