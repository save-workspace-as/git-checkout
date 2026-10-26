import type { GitHubRepository } from '../../shared/history/githubReferences';
import { createLogger } from '../../log';

const log = createLogger('github-avatars');

export const GITHUB_AVATAR_ORIGIN = 'https://avatars.githubusercontent.com';

/** Authors looked up on github.com for one page of the graph; the rest wait for the next page. */
const LOOKUPS_PER_BATCH = 25;
/** After GitHub says the rate limit is reached, no lookup is tried for this long. */
const RATE_LIMIT_PAUSE_MS = 15 * 60_000;

/**
 * The avatar of a GitHub no-reply address, which names the account: `123+login@users.noreply.github.com`
 * or the older `login@users.noreply.github.com`. No request is needed for these.
 */
export function noReplyAvatarUrl(email: string): string | undefined {
  const match = /^(?:(\d+)\+)?([^@\s]+)@users\.noreply\.github\.com$/i.exec(email.trim());
  if (!match) {
    return undefined;
  }
  return match[1] ? `${GITHUB_AVATAR_ORIGIN}/u/${match[1]}?s=64` : `${GITHUB_AVATAR_ORIGIN}/${encodeURIComponent(match[2])}?s=64`;
}

/** The avatar GitHub gives a commit's author, from the commit API's `author.avatar_url`, if the author has an account. */
export function avatarFromCommitResponse(body: unknown): string | null {
  const author = (body as { author?: { avatar_url?: unknown } | null } | null)?.author;
  const url = author?.avatar_url;
  return typeof url === 'string' && url.startsWith(`${GITHUB_AVATAR_ORIGIN}/`) ? url : null;
}

export interface GitHubAvatarHost {
  /** GET a GitHub API URL; resolves to the status and parsed JSON body. */
  get(url: string, token: string | undefined): Promise<{ status: number; body: unknown }>;
  /** The person's GitHub sign-in in VS Code, if any, without asking for one. */
  token(): Promise<string | undefined>;
  now(): number;
}

/**
 * GitHub profile pictures for commit authors. An address is looked up once, from one of its commits,
 * and the answer (a picture or none) is kept for the session.
 */
export class GitHubAvatars {
  private readonly byEmail = new Map<string, string | null>();
  private pausedUntil = 0;

  constructor(private readonly host: GitHubAvatarHost) {}

  /** The known picture for an address: a URL, null when the author has none, undefined when not looked up yet. */
  known(email: string): string | null | undefined {
    const key = email.trim().toLowerCase();
    if (!this.byEmail.has(key)) {
      const noReply = noReplyAvatarUrl(key);
      if (noReply) {
        this.byEmail.set(key, noReply);
      }
    }
    return this.byEmail.get(key);
  }

  /** Looks up the authors of `commits` not known yet; resolves to the pictures found, by lowercase address. */
  async lookUp(repo: GitHubRepository, commits: readonly { sha: string; authorEmail: string }[]): Promise<Record<string, string>> {
    const pending = new Map<string, string>();
    for (const commit of commits) {
      const key = commit.authorEmail.trim().toLowerCase();
      if (key && this.known(key) === undefined && !pending.has(key)) {
        pending.set(key, commit.sha);
      }
    }
    const found: Record<string, string> = {};
    if (pending.size === 0 || this.host.now() < this.pausedUntil) {
      return found;
    }
    const token = await this.host.token();
    for (const [email, sha] of [...pending].slice(0, LOOKUPS_PER_BATCH)) {
      const url = `https://api.${repo.host}/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/commits/${sha}`;
      try {
        const response = await this.host.get(url, token);
        if (response.status === 403 || response.status === 429) {
          this.pausedUntil = this.host.now() + RATE_LIMIT_PAUSE_MS;
          log.warn(`GitHub rate limit reached; avatars resume in ${RATE_LIMIT_PAUSE_MS / 60_000} minutes`);
          break;
        }
        const avatar = response.status === 200 ? avatarFromCommitResponse(response.body) : null;
        this.byEmail.set(email, avatar);
        if (avatar) {
          found[email] = avatar;
        }
      } catch (error) {
        log.warn('could not look up a GitHub avatar', error);
        break;
      }
    }
    return found;
  }
}
