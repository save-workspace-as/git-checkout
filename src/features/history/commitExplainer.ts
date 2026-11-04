import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { getGitCliRegistry } from '../../core/gitCliRegistry';
import { aiDisabledMessage, AiDisabledError, askLanguageModel, NoLanguageModelError } from '../../core/languageModel';
import { showMarkdownBeside } from '../../core/markdownDocument';
import { createLogger } from '../../log';
import { buildExplainPrompt } from '../../shared/history/commitExplainPrompt';
import { loadCommitForExplain } from './commitExplainSource';

const log = createLogger('commit-explainer');

/** Has the language model explain a commit, and shows the explanation as a Markdown document beside the graph. */
export async function explainCommit(repoRoot: string, revision: string): Promise<void> {
  let shown: { sha: string; subject: string; explanation: string } | undefined;
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: l10n.t('Explaining the commit…'), cancellable: true },
    async (_progress, token) => {
      try {
        const commit = await loadCommitForExplain(getGitCliRegistry().getOrCreate(repoRoot), revision);
        const explanation = (await askLanguageModel(buildExplainPrompt(commit), token)).trim();
        if (explanation) {
          shown = { sha: commit.sha, subject: commit.message.split('\n')[0] ?? '', explanation };
        } else {
          void vscode.window.showWarningMessage(l10n.t('The language model did not explain the commit.'));
        }
      } catch (error) {
        if (token.isCancellationRequested) {
          return;
        }
        if (error instanceof AiDisabledError) {
          void vscode.window.showInformationMessage(aiDisabledMessage());
          return;
        }
        if (error instanceof NoLanguageModelError) {
          void vscode.window.showInformationMessage(
            l10n.t('No language model is available. Sign in to GitHub Copilot or install a model provider to explain commits.'),
          );
          return;
        }
        log.error('could not explain the commit', error);
        void vscode.window.showErrorMessage(
          l10n.t('Could not explain the commit: {0}', error instanceof Error ? error.message : String(error)),
        );
      }
    },
  );
  if (!shown) {
    return;
  }
  await showMarkdownBeside(`# ${shown.sha.slice(0, 7)} ${shown.subject}\n\n${shown.explanation}\n`);
}
