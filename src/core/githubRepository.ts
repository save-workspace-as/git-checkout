import { pickGitHubRepository, type GitHubRepository } from '../shared/history/githubReferences';
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
