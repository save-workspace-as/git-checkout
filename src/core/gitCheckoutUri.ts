import type { Uri } from 'vscode';

export const GIT_CHECKOUT_SCHEME = 'git-checkout';

export interface GitCheckoutBlobLocation {
  repoRoot: string;
  revision: string;
  path: string;
}

export function buildGitCheckoutBlobQuery(
  repoRoot: string,
  revision: string,
  repoRelativePath: string,
): string {
  const query = new URLSearchParams({
    root: repoRoot,
    rev: revision,
    path: repoRelativePath.replace(/\\/g, '/'),
  });
  return query.toString();
}

/** Serialized `git-checkout:` URI for `git show <revision>:<path>` in `repoRoot`. */
export function buildGitCheckoutBlobUri(
  repoRoot: string,
  revision: string,
  repoRelativePath: string,
): string {
  const query = buildGitCheckoutBlobQuery(repoRoot, revision, repoRelativePath);
  // The path keeps the file name so VS Code's own language detection can highlight it.
  const encoded = repoRelativePath
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `${GIT_CHECKOUT_SCHEME}:/${encoded}?${query}`;
}

export function parseGitCheckoutBlobUri(uri: Uri): GitCheckoutBlobLocation | null {
  if (uri.scheme !== GIT_CHECKOUT_SCHEME) {
    return null;
  }
  const params = new URLSearchParams(uri.query);
  const root = params.get('root');
  const rev = params.get('rev');
  const path = params.get('path');
  if (!root || rev === null || !path) {
    return null;
  }
  return { repoRoot: root, revision: rev, path };
}

export function gitShowObjectSpec(revision: string, repoRelativePath: string): string {
  const normalized = repoRelativePath.replace(/\\/g, '/');
  if (revision === ':') {
    return `:${normalized}`;
  }
  return `${revision}:${normalized}`;
}
