import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import type { HistoryService } from '../history/historyService';
import { GitCliError } from '../../core/gitCliError';
import { pickMainlineParent } from '../history/mergeParentHost';
import { createLogger } from '../../log';

const log = createLogger('graph-history');

export async function promptHistorySha(action: string): Promise<string | null> {
  const sha = await vscode.window.showInputBox({
    prompt: l10n.t('{0} commit', action),
    placeHolder: l10n.t('Hash or ref'),
    validateInput: (v) => (v.trim() ? undefined : l10n.t('Hash is required')),
  });
  return sha?.trim() ?? null;
}

export async function runCherryPick(
  historyService: HistoryService,
  repoRoot: string,
  sha: string,
  token?: vscode.CancellationToken,
): Promise<void> {
  const parents = await historyService.getParents(repoRoot, sha);
  const mainline = await pickMainlineParent(parents, 'cherry-pick');
  if (!mainline) {
    return;
  }
  await historyService.cherryPick(
    repoRoot,
    sha,
    parents.length > 1 ? mainline : undefined,
    { cancellationToken: token },
  );
}

export async function runRevert(
  historyService: HistoryService,
  repoRoot: string,
  sha: string,
  token?: vscode.CancellationToken,
): Promise<void> {
  const parents = await historyService.getParents(repoRoot, sha);
  const mainline = await pickMainlineParent(parents, 'revert');
  if (!mainline) {
    return;
  }
  await historyService.revert(repoRoot, sha, mainline, { cancellationToken: token });
}

export async function runRangeOp(
  historyService: HistoryService,
  repoRoot: string,
  op: 'squash' | 'drop' | 'cherryPick',
  shas: string[],
  token?: vscode.CancellationToken,
): Promise<void> {
  if (shas.length === 0) {
    void vscode.window.showWarningMessage(l10n.t('Select at least one commit.'));
    return;
  }

  try {
    if (op === 'cherryPick') {
      await historyService.cherryPickRange(repoRoot, shas, { cancellationToken: token });
      return;
    }
    if (op === 'drop') {
      if (shas.length < 2) {
        void vscode.window.showWarningMessage(l10n.t('Select at least two commits to drop.'));
        return;
      }
      await historyService.dropRange(repoRoot, shas, { cancellationToken: token });
      return;
    }
    if (shas.length < 2) {
      void vscode.window.showWarningMessage(l10n.t('Select at least two commits to squash.'));
      return;
    }
    const message = await vscode.window.showInputBox({
      prompt: l10n.t('Squashed commit message'),
      validateInput: (v) => (v.trim() ? undefined : l10n.t('Message is required')),
    });
    if (!message?.trim()) {
      return;
    }
    await historyService.squashRange(repoRoot, shas, message.trim(), {
      cancellationToken: token,
    });
  } catch (error) {
    if (error instanceof GitCliError) {
      throw error;
    }
    const text = error instanceof Error ? error.message : String(error);
    log.error(`history ${op} failed`, error);
    void vscode.window.showWarningMessage(text);
  }
}
