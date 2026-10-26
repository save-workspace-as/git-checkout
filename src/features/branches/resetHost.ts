import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';

export async function promptResetTarget(): Promise<string | null> {
  const sha = await vscode.window.showInputBox({
    prompt: l10n.t('Reset current branch to commit'),
    placeHolder: l10n.t('branch, tag, or hash'),
    validateInput: (v) => (v.trim() ? undefined : l10n.t('Target is required')),
  });
  return sha?.trim() ?? null;
}
