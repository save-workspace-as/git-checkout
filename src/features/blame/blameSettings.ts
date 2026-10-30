import * as vscode from 'vscode';

/** Whether blame leaves out the commits of `.git-blame-ignore-revs`. */
export function ignoreRevsEnabled(): boolean {
  return vscode.workspace.getConfiguration('gitCheckout.blame').get<boolean>('ignoreRevs', true);
}
