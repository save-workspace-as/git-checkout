import type { GitHubRepository } from './githubReferences';

const encodePath = (path: string): string => path.split('/').filter(Boolean).map(encodeURIComponent).join('/');

/** The repository's address, with no trailing slash. */
export function repositoryUrl(repo: GitHubRepository): string {
  return `https://${repo.host}/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}`;
}

export function commitUrl(repo: GitHubRepository, sha: string): string {
  return `${repositoryUrl(repo)}/commit/${encodeURIComponent(sha)}`;
}

export function branchUrl(repo: GitHubRepository, branch: string): string {
  return `${repositoryUrl(repo)}/tree/${encodePath(branch)}`;
}

/** Lines of a file, 1-based and both ends included; one line when `last` is the same or missing. */
export interface LineRange {
  first: number;
  last?: number;
}

/** A file at a branch, tag or commit, with lines picked out as GitHub's `#L5-L9` does. */
export function fileUrl(repo: GitHubRepository, ref: string, path: string, lines?: LineRange): string {
  const anchor = lines && lines.first > 0 ? `#L${lines.first}${lines.last && lines.last > lines.first ? `-L${lines.last}` : ''}` : '';
  return `${repositoryUrl(repo)}/blob/${encodePath(ref)}/${encodePath(path)}${anchor}`;
}
