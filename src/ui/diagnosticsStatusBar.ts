import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import type { GitExtensionService } from '../core/gitExtensionService';
import { formatDiagnostics, type WorkspaceDiagnostics } from '../core/diagnostics';

export class DiagnosticsStatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;

  constructor(private readonly gitService: GitExtensionService) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.command = 'gitCheckout.showOutput';
    this.item.show();
    this.refresh();
  }

  refresh(): void {
    const d = this.gitService.getDiagnostics();
    this.item.text = statusText(d);
    this.item.tooltip = formatDiagnostics(d);
  }

  dispose(): void {
    this.item.dispose();
  }
}

function statusText(d: WorkspaceDiagnostics): string {
  switch (d.bindingState) {
    case 'git_extension_missing':
      return l10n.t('$(error) Git Checkout: Built-in Git unavailable');
    case 'git_disabled':
      return l10n.t('$(warning) Git Checkout: Git disabled');
    case 'api_unavailable':
      return l10n.t('$(warning) Git Checkout: Git API unavailable');
    case 'ready':
      break;
  }

  const remote = d.remoteName ?? 'local';
  if (d.repositories.length === 0) {
    return l10n.t('$(folder) Git Checkout: no repository · {0}', remote);
  }

  if (d.repositories.length === 1) {
    const head = d.repositories[0].headName ?? l10n.t('detached HEAD');
    return l10n.t('$(source-control) Git Checkout: {0} · {1}', head, remote);
  }

  return l10n.t('$(source-control) Git Checkout: {0} repositories · {1}', d.repositories.length, remote);
}
