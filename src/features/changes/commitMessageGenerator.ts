import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';

import { createLogger } from '../../log';
import { buildCommitPrompt, parseGeneratedMessage } from '../../shared/changes/commitMessagePrompt';

const log = createLogger('commit-message');

/**
 * Drafts a commit message for the staged changes with a language model VS Code provides, such as
 * GitHub Copilot's. Returns undefined when there is no model or the request is cancelled or fails.
 */
export async function generateCommitMessage(
  diff: string,
  recentSubjects: readonly string[],
  token: vscode.CancellationToken,
): Promise<{ subject: string; description: string } | undefined> {
  const models = await vscode.lm.selectChatModels();
  const model = models[0];
  if (!model) {
    void vscode.window.showInformationMessage(
      l10n.t('No language model is available. Sign in to GitHub Copilot or install a model provider to write commit messages.'),
    );
    return undefined;
  }
  try {
    const response = await model.sendRequest(
      [vscode.LanguageModelChatMessage.User(buildCommitPrompt({ diff, recentSubjects }))],
      {},
      token,
    );
    let reply = '';
    for await (const chunk of response.text) {
      reply += chunk;
    }
    const message = parseGeneratedMessage(reply);
    return message.subject ? message : undefined;
  } catch (error) {
    if (token.isCancellationRequested) {
      return undefined;
    }
    log.error('commit message generation failed', error);
    void vscode.window.showErrorMessage(
      l10n.t('Could not write a commit message: {0}', error instanceof Error ? error.message : String(error)),
    );
    return undefined;
  }
}
