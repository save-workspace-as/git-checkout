import * as vscode from 'vscode';
import * as l10n from '@vscode/l10n';

export async function copyTextToClipboard(text: string): Promise<void> {
  await vscode.env.clipboard.writeText(text);
  vscode.window.setStatusBarMessage(l10n.t('Copied to clipboard'), 2000);
}
