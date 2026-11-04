import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import type { GitCli } from '../../core/gitCli';
import { aiDisabledMessage, AiDisabledError, askLanguageModel, NoLanguageModelError } from '../../core/languageModel';
import { showMarkdownBeside } from '../../core/markdownDocument';
import { createLogger } from '../../log';
import { buildReviewPrompt } from '../../shared/changes/reviewPrompt';

const log = createLogger('staged-review');

/** Has the language model review what is staged, and shows its findings as a Markdown document beside the form. */
export async function reviewStagedChanges(cli: GitCli): Promise<void> {
  let findings: string | undefined;
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: l10n.t('Reviewing the staged changes…'), cancellable: true },
    async (_progress, token) => {
      try {
        const diff = (await cli.execRead(['diff', '--cached', '--no-color', '-U3', '--patch-with-stat'])).stdout;
        if (!diff.trim()) {
          void vscode.window.showInformationMessage(l10n.t('Stage changes first, then review them.'));
          return;
        }
        findings = (await askLanguageModel(buildReviewPrompt(diff), token)).trim() || undefined;
        if (!findings) {
          void vscode.window.showWarningMessage(l10n.t('The language model did not review the changes.'));
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
            l10n.t('No language model is available. Sign in to GitHub Copilot or install a model provider to review changes.'),
          );
          return;
        }
        log.error('could not review the staged changes', error);
        void vscode.window.showErrorMessage(
          l10n.t('Could not review the changes: {0}', error instanceof Error ? error.message : String(error)),
        );
      }
    },
  );
  if (findings) {
    await showMarkdownBeside(`# ${l10n.t('Review of the staged changes')}\n\n${findings}\n`);
  }
}
