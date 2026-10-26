import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { getGitCliRegistry } from '../../core/gitCliRegistry';
import { loadGitHubRepository } from '../../core/githubRepository';
import { createLogger } from '../../log';
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

export async function openGitHubIssueLink(url: string, repo: GitHubRepository | null): Promise<void> {
  const allowed = canonicalGitHubIssueUrl(url, repo) ?? canonicalGitHubCommitUrl(url, repo);
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
