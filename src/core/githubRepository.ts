import { pickGitHubRemote, pickGitHubRepository, type GitHubRepository } from '../shared/history/githubReferences';
import { loadRemoteUrls, parseRemoteNames } from './gitRefParser';

export async function loadGitHubRepository(cli: {
  execRead: (args: string[]) => Promise<{ stdout: string }>;
}): Promise<GitHubRepository | null> {
  const listed = await cli.execRead(['remote']);
  const names = parseRemoteNames(listed.stdout);
  if (names.length === 0) {
    return null;
  }
  const remotes = await loadRemoteUrls(cli, names);
  return pickGitHubRepository(remotes);
}

/** The GitHub repository and the name of the remote that points at it, which the pull request refs are fetched from. */
export async function loadGitHubRemote(cli: {
  execRead: (args: string[]) => Promise<{ stdout: string }>;
}): Promise<{ remote: string; repo: GitHubRepository } | null> {
  const names = parseRemoteNames((await cli.execRead(['remote'])).stdout);
  return names.length === 0 ? null : pickGitHubRemote(await loadRemoteUrls(cli, names));
}
