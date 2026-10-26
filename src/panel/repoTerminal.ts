import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';

export function openTerminalForRepo(activeRepoRoot: string | null): void {
  if (!activeRepoRoot) {
    void vscode.window.showWarningMessage(l10n.t('No Git repository is open.'));
    return;
  }
  const terminal = vscode.window.createTerminal({
    name: l10n.t('Git Checkout'),
    cwd: vscode.Uri.file(activeRepoRoot),
  });
  terminal.show();
}
