import { createLogger } from '../../log';
import type { GitHubRepository } from '../../shared/history/githubReferences';

const log = createLogger('github-rest');

/** The REST version that has the stacks endpoints. */
const STACKS_API_VERSION = '2026-03-10';

/** How a request reaches GitHub's REST API; the tests answer instead. */
export interface RestTransport {
  request(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, token: string, body?: unknown, headers?: Record<string, string>): Promise<{ status: number; json: unknown }>;
}

export const fetchRestTransport: RestTransport = {
  async request(method, url, token, body, headers) {
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'git-checkout-vscode',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const json: unknown = await response.json().catch((error: unknown) => {
      // A success with no body, or an error page that is not JSON; the status says what happened.
      log.debug('answer is not JSON', error);
      return null;
    });
    return { status: response.status, json };
  },
};

/** Why GitHub did not do what was asked, as far as the person can act on it. */
export type RestFailure = 'unauthorized' | 'forbidden' | 'notFound' | 'invalid' | 'conflict' | 'network' | 'other';

export class GitHubRestError extends Error {
  constructor(
    readonly failure: RestFailure,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'GitHubRestError';
  }
}

/** github.com has its own API address; other hosts (GitHub Enterprise) serve it under `/api/v3`. */
export function restUrl(repo: GitHubRepository, path: string): string {
  const root = repo.host === 'github.com' ? 'https://api.github.com' : `https://${repo.host}/api/v3`;
  return `${root}/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}${path}`;
}

/** GitHub's own sentence for what was wrong, with the details of a validation error, if it gave any. */
function messageOf(json: unknown, status: number): string {
  const body = json as { message?: unknown; errors?: unknown } | null;
  const parts = [typeof body?.message === 'string' ? body.message : ''];
  if (Array.isArray(body?.errors)) {
    for (const entry of body.errors) {
      const text = typeof entry === 'string' ? entry : (entry as { message?: unknown } | null)?.message;
      if (typeof text === 'string') {
        parts.push(text);
      }
    }
  }
  return parts.filter(Boolean).join(' ') || `GitHub answered with status ${status}.`;
}

async function call(
  transport: RestTransport,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  token: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<unknown> {
  let answer: { status: number; json: unknown };
  try {
    answer = await transport.request(method, url, token, body, headers);
  } catch (error) {
    log.warn('could not reach GitHub', error);
    throw new GitHubRestError('network', 0, error instanceof Error ? error.message : String(error));
  }
  if (answer.status >= 200 && answer.status < 300) {
    return answer.json;
  }
  const failure: RestFailure = answer.status === 401 ? 'unauthorized'
    : answer.status === 403 || answer.status === 429 ? 'forbidden'
      : answer.status === 404 ? 'notFound'
        : answer.status === 409 ? 'conflict'
          : answer.status === 422 ? 'invalid' : 'other';
  throw new GitHubRestError(failure, answer.status, messageOf(answer.json, answer.status));
}

export interface PullRequestInput {
  title: string;
  head: string;
  base: string;
  body: string;
  draft: boolean;
}

export interface CreatedPullRequest {
  number: number;
  url: string;
  base: string;
  draft: boolean;
}

function toPullRequest(json: unknown): CreatedPullRequest {
  const pull = json as { number?: unknown; html_url?: unknown; base?: { ref?: unknown }; draft?: unknown } | null;
  if (typeof pull?.number !== 'number' || typeof pull.html_url !== 'string') {
    throw new GitHubRestError('other', 0, 'GitHub answered with a pull request this extension does not understand.');
  }
  return { number: pull.number, url: pull.html_url, base: typeof pull.base?.ref === 'string' ? pull.base.ref : '', draft: pull.draft === true };
}

export async function createPullRequest(repo: GitHubRepository, token: string, input: PullRequestInput, transport: RestTransport = fetchRestTransport): Promise<CreatedPullRequest> {
  return toPullRequest(await call(transport, 'POST', restUrl(repo, '/pulls'), token, input));
}

/** The open pull request whose head is this branch of the repository itself, if there is one. */
export async function findOpenPullRequest(repo: GitHubRepository, token: string, head: string, transport: RestTransport = fetchRestTransport): Promise<CreatedPullRequest | undefined> {
  const url = `${restUrl(repo, '/pulls')}?state=open&head=${encodeURIComponent(`${repo.owner}:${head}`)}`;
  const list = await call(transport, 'GET', url, token);
  return Array.isArray(list) && list.length > 0 ? toPullRequest(list[0]) : undefined;
}

export async function setPullRequestBase(repo: GitHubRepository, token: string, number: number, base: string, transport: RestTransport = fetchRestTransport): Promise<CreatedPullRequest> {
  return toPullRequest(await call(transport, 'PATCH', restUrl(repo, `/pulls/${number}`), token, { base }));
}

export interface PullRequestStack {
  number: number;
  url: string;
  /** Whether any pull request of the stack is still open. */
  open: boolean;
  /** The pull requests from the bottom of the stack to the top. */
  pullRequests: number[];
}

function toStack(json: unknown): PullRequestStack {
  const stack = json as { number?: unknown; url?: unknown; open?: unknown; pull_requests?: unknown } | null;
  if (typeof stack?.number !== 'number' || !Array.isArray(stack.pull_requests)) {
    throw new GitHubRestError('other', 0, 'GitHub answered with a stack this extension does not understand.');
  }
  return {
    number: stack.number,
    url: typeof stack.url === 'string' ? stack.url : '',
    open: stack.open !== false,
    pullRequests: stack.pull_requests.map((pull) => (pull as { number?: unknown } | null)?.number).filter((n): n is number => typeof n === 'number'),
  };
}

const versioned = { 'X-GitHub-Api-Version': STACKS_API_VERSION };

/** Groups pull requests, bottom first, into a stack. */
export async function createStack(repo: GitHubRepository, token: string, pullRequests: readonly number[], transport: RestTransport = fetchRestTransport): Promise<PullRequestStack> {
  return toStack(await call(transport, 'POST', restUrl(repo, '/stacks'), token, { pull_requests: pullRequests }, versioned));
}

/** The most recent stacks of the repository, open or not. */
export async function listStacks(repo: GitHubRepository, token: string, transport: RestTransport = fetchRestTransport): Promise<PullRequestStack[]> {
  const list = await call(transport, 'GET', `${restUrl(repo, '/stacks')}?per_page=100`, token, undefined, versioned);
  return Array.isArray(list) ? list.map(toStack) : [];
}

/** Puts pull requests on top of a stack, in order from the current top upward. */
export async function addToStack(repo: GitHubRepository, token: string, stack: number, pullRequests: readonly number[], transport: RestTransport = fetchRestTransport): Promise<PullRequestStack> {
  return toStack(await call(transport, 'POST', restUrl(repo, `/stacks/${stack}/add`), token, { pull_requests: pullRequests }, versioned));
}
