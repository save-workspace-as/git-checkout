import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';

export async function promptCheckoutRef(): Promise<string | null> {
  const ref = await vscode.window.showInputBox({
    prompt: l10n.t('Checkout a branch, tag, or revision'),
    placeHolder: l10n.t('e.g. main, origin/main, abc1234'),
    validateInput: (v) => (v.trim() ? undefined : l10n.t('Ref is required')),
  });
  return ref?.trim() ?? null;
}
