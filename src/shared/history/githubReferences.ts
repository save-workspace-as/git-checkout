/** GitHub repository a local remote points at. */
export interface GitHubRepository {
  /** Hostname without scheme, for example `github.com`. */
  host: string;
  owner: string;
  repo: string;
}

export type GitHubTextSegment =
  | { kind: 'text'; text: string }
  | { kind: 'link'; text: string; url: string };

const NAME = '[A-Za-z0-9_.-]+';
const NUMBER = '[1-9]\\d*';

const REFERENCE =
  `https?:\\/\\/[^\\s<>]+|(${NAME})\\/(${NAME})#(${NUMBER})\\b|GH-(${NUMBER})\\b|#(${NUMBER})\\b`;

export function parseGitHubRemoteUrl(raw: string): GitHubRepository | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  const scp = /^git@([^:]+):(.+)$/.exec(trimmed);
  let host = '';
  let path = '';
  if (scp) {
    host = scp[1] ?? '';
    path = scp[2] ?? '';
  } else {
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      return null;
    }
    if (
      parsed.protocol !== 'https:' &&
      parsed.protocol !== 'http:' &&
      parsed.protocol !== 'ssh:' &&
      parsed.protocol !== 'git:'
    ) {
      return null;
    }
    host = parsed.hostname;
    path = parsed.pathname;
  }
  const canonicalHost = githubHost(host);
  if (!canonicalHost) {
    return null;
  }
  const parts = path
    .replace(/\.git$/i, '')
    .split('/')
    .filter(Boolean);
  if (parts.length !== 2) {
    return null;
  }
  const owner = parts[0] ?? '';
  const repo = parts[1] ?? '';
  if (!isGitHubName(owner) || !isGitHubName(repo)) {
    return null;
  }
  return { host: canonicalHost, owner, repo };
}

/** Prefer `origin` when it is a GitHub remote; otherwise the first GitHub remote. */
export function pickGitHubRemote(
  remotes: readonly { name: string; urls: readonly string[] }[],
): { remote: string; repo: GitHubRepository } | null {
  const origin = remotes.find((remote) => remote.name === 'origin');
  const ordered = origin ? [origin, ...remotes.filter((remote) => remote !== origin)] : remotes;
  for (const remote of ordered) {
    for (const url of remote.urls) {
      const parsed = parseGitHubRemoteUrl(url);
      if (parsed) {
        return { remote: remote.name, repo: parsed };
      }
    }
  }
  return null;
}

export function pickGitHubRepository(
  remotes: readonly { name: string; urls: readonly string[] }[],
): GitHubRepository | null {
  return pickGitHubRemote(remotes)?.repo ?? null;
}

/**
 * Splits titles and messages into plain text and GitHub issue or pull request links.
 * `#n` and `GH-n` need `repo`. `owner/repo#n` and full issue or pull URLs do not.
 */
export function segmentGitHubReferences(
  text: string,
  repo: GitHubRepository | null,
): GitHubTextSegment[] {
  const segments: GitHubTextSegment[] = [];
  const pattern = new RegExp(REFERENCE, 'gi');
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index < cursor || !startsReference(text, index)) {
      continue;
    }
    const link = linkFromMatch(match, repo);
    if (!link) {
      continue;
    }
    if (index > cursor) {
      segments.push({ kind: 'text', text: text.slice(cursor, index) });
    }
    segments.push({ kind: 'link', text: link.text, url: link.url });
    cursor = index + link.text.length;
  }
  if (cursor < text.length) {
    segments.push({ kind: 'text', text: text.slice(cursor) });
  }
  if (segments.length === 0) {
    segments.push({ kind: 'text', text });
  }
  return segments;
}

/** https issue or pull URL on github.com or the repository host. Null when the URL is not one. */
export function canonicalGitHubIssueUrl(value: string, repo: GitHubRepository | null): string | null {
  const page = githubPage(value, repo);
  if (!page || page.parts.length !== 4) {
    return null;
  }
  const owner = page.parts[0] ?? '';
  const name = page.parts[1] ?? '';
  const kind = page.parts[2] ?? '';
  const number = page.parts[3] ?? '';
  if (!isGitHubName(owner) || !isGitHubName(name)) {
    return null;
  }
  if (kind !== 'issues' && kind !== 'pull') {
    return null;
  }
  if (!/^[1-9]\d*$/.test(number)) {
    return null;
  }
  return `https://${page.host}/${owner}/${name}/${kind}/${number}`;
}

/** https commit URL on github.com or the repository host. Null when the URL is not one. */
export function canonicalGitHubCommitUrl(value: string, repo: GitHubRepository | null): string | null {
  const page = githubPage(value, repo);
  if (!page || page.parts.length !== 4) {
    return null;
  }
  const owner = page.parts[0] ?? '';
  const name = page.parts[1] ?? '';
  const kind = page.parts[2] ?? '';
  const sha = page.parts[3] ?? '';
  if (!isGitHubName(owner) || !isGitHubName(name) || kind !== 'commit' || !/^[0-9a-f]{7,64}$/i.test(sha)) {
    return null;
  }
  return `https://${page.host}/${owner}/${name}/commit/${sha.toLowerCase()}`;
}

function githubPage(value: string, repo: GitHubRepository | null): { host: string; parts: string[] } | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.username || url.password || (url.protocol !== 'https:' && url.protocol !== 'http:')) {
    return null;
  }
  const host = githubHost(url.hostname);
  if (!host || !allowedIssueHost(host, repo)) {
    return null;
  }
  return { host, parts: url.pathname.split('/').filter(Boolean) };
}

function linkFromMatch(match: RegExpMatchArray, repo: GitHubRepository | null): { text: string; url: string } | null {
  const raw = match[0] ?? '';
  if (/^https?:\/\//i.test(raw)) {
    const text = raw.replace(/[.,;:!?)\]]+$/, '');
    const url = canonicalGitHubIssueUrl(text, repo);
    return url ? { text, url } : null;
  }
  const owner = match[1];
  const name = match[2];
  const crossNumber = match[3];
  if (owner && name && crossNumber) {
    const host = repo?.host ?? 'github.com';
    return { text: raw, url: issueUrl(host, owner, name, crossNumber) };
  }
  const ghNumber = match[4];
  const hashNumber = match[5];
  const number = ghNumber || hashNumber;
  if (!number || !repo) {
    return null;
  }
  return { text: raw, url: issueUrl(repo.host, repo.owner, repo.repo, number) };
}

function issueUrl(host: string, owner: string, repo: string, number: string): string {
  return `https://${host}/${owner}/${repo}/issues/${number}`;
}

function startsReference(text: string, index: number): boolean {
  if (index === 0) {
    return true;
  }
  const prev = text[index - 1] ?? '';
  if (prev === '/') {
    return false;
  }
  return !/[A-Za-z0-9_.-]/.test(prev);
}

function allowedIssueHost(host: string, repo: GitHubRepository | null): boolean {
  return host === 'github.com' || host === repo?.host;
}

function githubHost(host: string): string | null {
  const normalized = host.trim().toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
  if (normalized === 'github.com' || normalized.endsWith('.ghe.com') || normalized.startsWith('github.')) {
    return normalized;
  }
  return null;
}

function isGitHubName(value: string): boolean {
  return /^[A-Za-z0-9_.-]+$/.test(value) && !value.includes('..') && value !== '.' && value !== '..';
}

/** The page that starts a pull request for a branch. GitHub offers the base and fills in the title. */
export function pullRequestUrl(repo: GitHubRepository, branch: string): string {
  const name = branch.split('/').map(encodeURIComponent).join('/');
  return `https://${repo.host}/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/pull/new/${name}`;
}
