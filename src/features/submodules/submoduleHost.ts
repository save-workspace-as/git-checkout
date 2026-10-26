import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';

import { sameWorktreePath } from '../worktrees/worktreeParser';

export async function confirmOpenSubmodule(submodulePath: string): Promise<boolean> {
  const choice = await vscode.window.showInformationMessage(
    l10n.t('Open {0} in a new window?', submodulePath),
    { modal: true },
    l10n.t('Open Folder'),
  );
  return choice === l10n.t('Open Folder');
}

export async function confirmDeleteSubmodule(submodulePath: string): Promise<boolean> {
  const choice = await vscode.window.showWarningMessage(
    l10n.t('Delete submodule {0}?', submodulePath),
    {
      modal: true,
      detail: l10n.t(
        'This removes it from .gitmodules, the index, and the working tree. Uncommitted changes inside it are lost.',
      ),
    },
    l10n.t('Delete'),
  );
  return choice === l10n.t('Delete');
}

/** Adds the submodule as a workspace folder so it opens in this window. */
export function openSubmoduleInWorkspace(submodulePath: string): boolean {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.some((folder) => sameWorktreePath(folder.uri.fsPath, submodulePath))) {
    return true;
  }
  return vscode.workspace.updateWorkspaceFolders(folders.length, 0, {
    uri: vscode.Uri.file(submodulePath),
  });
}
