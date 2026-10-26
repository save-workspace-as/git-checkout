import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';

const bundle = vscode.l10n.bundle;
if (bundle) {
  l10n.config({ contents: bundle });
}
