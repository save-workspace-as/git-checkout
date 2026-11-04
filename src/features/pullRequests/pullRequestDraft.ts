import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { getGitCliRegistry } from '../../core/gitCliRegistry';
import { askLanguageModel, NoLanguageModelError } from '../../core/languageModel';
import { createLogger } from '../../log';
import { pullRequestUrl } from '../../shared/history/githubReferences';
import { buildPullRequestPrompt, canTravelInLink, linkableTitle, parsePullRequestText } from '../../shared/pullRequests/pullRequestPrompt';
import { githubRepositoryFor } from '../history/githubLinkHost';
import { loadBranchChanges } from './branchChanges';

const log = createLogger('pull-request-draft');

/**
 * Opens GitHub's page for a pull request from `branch` with a title and description the language model wrote from the
 * branch's commits and changes. Without a model, or when it fails, the page opens as it does without AI.
 */
export async function openPullRequestWithAi(repoRoot: string, branch: string): Promise<void> {
  const repo = await githubRepositoryFor(repoRoot);
  if (!repo) {
    void vscode.window.showWarningMessage(l10n.t('This repository has no GitHub remote.'));
    return;
  }
  let text: { title: string; body: string } | undefined;
  let canceled = false;
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: l10n.t('Writing a pull request description…'), cancellable: true },
    async (_progress, token) => {
      try {
        const changes = await loadBranchChanges(getGitCliRegistry().getOrCreate(repoRoot), branch);
        if (!changes) {
          void vscode.window.showInformationMessage(l10n.t("Could not find the branch that '{0}' would merge into.", branch));
          canceled = true;
          return;
        }
        if (changes.commits.length === 0) {
          void vscode.window.showInformationMessage(l10n.t("'{0}' has no commits that '{1}' does not have.", branch, changes.base));
          canceled = true;
          return;
        }
        const parsed = parsePullRequestText(await askLanguageModel(buildPullRequestPrompt({ branch, ...changes }), token));
        text = parsed.title ? parsed : undefined;
      } catch (error) {
        if (token.isCancellationRequested) {
          canceled = true;
        } else if (error instanceof NoLanguageModelError) {
          void vscode.window.showInformationMessage(
            l10n.t('No language model is available. Sign in to GitHub Copilot or install a model provider to write pull request descriptions.'),
          );
        } else {
          log.error('could not write a pull request description', error);
          void vscode.window.showErrorMessage(
            l10n.t('Could not write a pull request description: {0}', error instanceof Error ? error.message : String(error)),
          );
        }
      }
    },
  );
  if (canceled) {
    return;
  }
  let linked = text && { title: linkableTitle(text.title), body: text.body };
  if (text && linked && !canTravelInLink(text.body)) {
    // A link cannot carry this description, so it goes to the clipboard to be pasted into the page.
    await vscode.env.clipboard.writeText(text.body);
    linked = { title: linked.title, body: '' };
    void vscode.window.showInformationMessage(l10n.t('The description is on your clipboard. Paste it into the pull request page.'));
  }
  log.info('open pull request page');
  if (!(await vscode.env.openExternal(vscode.Uri.parse(pullRequestUrl(repo, branch, linked))))) {
    void vscode.window.showWarningMessage(l10n.t('Could not open the GitHub link.'));
  }
}
