import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import type { PullRequestChecks } from '../shared/pullRequests/pullRequests';

/** Rows with checks carry a resource with this scheme; the badge at the end of the row is drawn for it. */
export const CHECKS_SCHEME = 'git-checkout-checks';

export function checksUri(rowId: string, checks: PullRequestChecks): vscode.Uri {
  return vscode.Uri.from({ scheme: CHECKS_SCHEME, path: `/${encodeURIComponent(rowId)}`, query: checks });
}

/** The badge at the end of a pull request row: passed, failed or pending, colored like the same states on GitHub. */
export function registerChecksDecorations(): vscode.Disposable {
  return vscode.window.registerFileDecorationProvider({
    provideFileDecoration(uri) {
      if (uri.scheme !== CHECKS_SCHEME) {
        return undefined;
      }
      switch (uri.query) {
        case 'success':
          return { badge: '✓', tooltip: l10n.t('Checks passed'), color: new vscode.ThemeColor('charts.green') };
        case 'failure':
          return { badge: '✕', tooltip: l10n.t('Checks failed'), color: new vscode.ThemeColor('charts.red') };
        case 'pending':
          return { badge: '●', tooltip: l10n.t('Checks pending'), color: new vscode.ThemeColor('charts.yellow') };
        default:
          return undefined;
      }
    },
  });
}
