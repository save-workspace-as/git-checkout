import { createLogger } from '../../log';
import type { GitHubRepository } from '../../shared/history/githubReferences';
import {
  closedPullRequestsQuery, parseClosedPullRequests, parsePullRequestLists, pullRequestsQuery, type PullRequestDto, type PullRequestLists,
} from '../../shared/pullRequests/pullRequests';

const log = createLogger('pull-requests');

/** Why the pull requests could not be read, as far as the person can act on it. */
export type PullRequestFailure = 'unauthorized' | 'needsAccess' | 'rateLimited' | 'network' | 'other';

export class PullRequestError extends Error {
  constructor(
    readonly failure: PullRequestFailure,
    message: string,
  ) {
    super(message);
    this.name = 'PullRequestError';
  }
}

/** How a request reaches GitHub; the tests answer instead. */
export interface PullRequestTransport {
  post(url: string, body: string, token: string): Promise<{ status: number; json: unknown }>;
}

export const fetchTransport: PullRequestTransport = {
  async post(url, body, token) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'git-checkout-vscode' },
      body,
      signal: AbortSignal.timeout(20_000),
    });
    const json: unknown = await response.json().catch((error: unknown) => {
      // An error page that is not JSON; the status says what happened.
      log.debug('answer is not JSON', error);
      return null;
    });
    return { status: response.status, json };
  },
};

/** github.com has its own API address; other hosts (GitHub Enterprise) serve it under `/api`. */
export function graphqlUrl(repo: GitHubRepository): string {
  return repo.host === 'github.com' ? 'https://api.github.com/graphql' : `https://${repo.host}/api/graphql`;
}

/** Asks GitHub one GraphQL question and gives the answer's body; the failures are the ones a person can act on. */
async function ask(repo: GitHubRepository, token: string, request: { query: string; variables: Record<string, string> }, transport: PullRequestTransport): Promise<unknown> {
  let answer: { status: number; json: unknown };
  try {
    answer = await transport.post(graphqlUrl(repo), JSON.stringify(request), token);
  } catch (error) {
    log.warn('could not reach GitHub', error);
    throw new PullRequestError('network', error instanceof Error ? error.message : String(error));
  }
  const messages = ((answer.json as { errors?: { message?: unknown }[] } | null)?.errors ?? []).map((entry) => String(entry?.message ?? ''));
  if (answer.status === 401) {
    throw new PullRequestError('unauthorized', 'GitHub did not accept the sign-in.');
  }
  if (answer.status === 403 || answer.status === 429 || messages.some((message) => /rate limit/i.test(message))) {
    throw new PullRequestError('rateLimited', messages[0] || 'GitHub says too many requests were made.');
  }
  // A private repository the token cannot see is not an error to GitHub's search; it says the repository "cannot be searched".
  if (messages.some((message) => /cannot be searched|could not resolve to a repository/i.test(message))) {
    throw new PullRequestError('needsAccess', messages[0]);
  }
  if (answer.status !== 200) {
    throw new PullRequestError('other', messages[0] || `GitHub answered with status ${answer.status}.`);
  }
  return answer.json;
}

const unexpected = (body: unknown): PullRequestError => {
  const message = ((body as { errors?: { message?: unknown }[] } | null)?.errors ?? []).map((entry) => String(entry?.message ?? ''))[0];
  return new PullRequestError('other', message || 'GitHub answered with status 200.');
};

/** The open pull requests of a repository, in the three lists the sidebar shows. */
export async function fetchPullRequestLists(repo: GitHubRepository, token: string, transport: PullRequestTransport = fetchTransport): Promise<PullRequestLists> {
  const body = await ask(repo, token, pullRequestsQuery(repo), transport);
  const lists = parsePullRequestLists(body);
  if (!lists) {
    throw unexpected(body);
  }
  return lists;
}

/** The latest closed and merged pull requests of a repository. */
export async function fetchClosedPullRequests(repo: GitHubRepository, token: string, transport: PullRequestTransport = fetchTransport): Promise<PullRequestDto[]> {
  const body = await ask(repo, token, closedPullRequestsQuery(repo), transport);
  const pulls = parseClosedPullRequests(body);
  if (!pulls) {
    throw unexpected(body);
  }
  return pulls;
}
