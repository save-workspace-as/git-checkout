import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { getGitCliRegistry } from '../../core/gitCliRegistry';
import { loadGitHubRepository } from '../../core/githubRepository';
import { createLogger } from '../../log';
import { remoteWebUrl } from '../../shared/history/remoteWebUrl';
import { isAutolinkUrl, parseAutolinkRules, type AutolinkRule } from '../../shared/history/autolinks';
import {
  canonicalGitHubCommitUrl,
  canonicalGitHubIssueUrl,
  pullRequestUrl,
  type GitHubRepository,
} from '../../shared/history/githubReferences';

const log = createLogger('github-link');

export async function githubRepositoryFor(repoRoot: string): Promise<GitHubRepository | null> {
  try {
    return await loadGitHubRepository(getGitCliRegistry().getOrCreate(repoRoot));
  } catch (error) {
    log.warn('could not resolve GitHub repository', error);
    return null;
  }
}

export async function openGitHubIssueLink(url: string, repo: GitHubRepository | null, autolinks: readonly AutolinkRule[] = []): Promise<void> {
  const allowed = canonicalGitHubIssueUrl(url, repo) ?? canonicalGitHubCommitUrl(url, repo) ?? (isAutolinkUrl(url, autolinks) ? url : null);
  if (!allowed) {
    log.warn('rejected a GitHub link');
    return;
  }
  log.info('open GitHub link');
  const opened = await vscode.env.openExternal(vscode.Uri.parse(allowed));
  if (!opened) {
    void vscode.window.showWarningMessage(l10n.t('Could not open the GitHub link.'));
  }
}

/** Opens GitHub's page for a pull request from `branch`, or says that the repository is not on GitHub. */
export async function openPullRequestPage(repoRoot: string, branch: string): Promise<void> {
  const repo = await githubRepositoryFor(repoRoot);
  if (!repo) {
    void vscode.window.showWarningMessage(l10n.t('This repository has no GitHub remote.'));
    return;
  }
  log.info('open pull request page');
  if (!(await vscode.env.openExternal(vscode.Uri.parse(pullRequestUrl(repo, branch))))) {
    void vscode.window.showWarningMessage(l10n.t('Could not open the GitHub link.'));
  }
}

/** The autolinks the user set up in `gitCheckout.autolinks`; the entries that cannot work are left out. */
export function readAutolinks(): AutolinkRule[] {
  return parseAutolinkRules(vscode.workspace.getConfiguration('gitCheckout').get('autolinks'));
}

/** Opens the web page of a remote, from its first address, whatever kind of address that is. */
export async function openRemoteInBrowser(repoRoot: string | null, remote: string): Promise<void> {
  if (!repoRoot) {
    void vscode.window.showWarningMessage(l10n.t('No Git repository is open.'));
    return;
  }
  let urls: string[] = [];
  try {
    urls = (await getGitCliRegistry().getOrCreate(repoRoot).execRead(['remote', 'get-url', '--all', remote])).stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch (error) {
    log.warn('could not read the address of the remote', error);
  }
  const page = urls.map(remoteWebUrl).find((url) => url !== undefined);
  if (!page) {
    void vscode.window.showWarningMessage(l10n.t("The remote '{0}' has no web page to open.", remote));
    return;
  }
  log.info('open remote in the browser');
  if (!(await vscode.env.openExternal(vscode.Uri.parse(page)))) {
    void vscode.window.showWarningMessage(l10n.t('Could not open the link.'));
  }
}
