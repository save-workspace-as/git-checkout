import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import * as path from 'node:path';
import { validateWorktreeDestination, WORKTREE_NONEMPTY_FOLDER, worktreeBrowseStart } from './worktreeCreate';
import type { WorktreeCreateRequest } from '../../shared/worktrees/worktreeProtocol';
import type { ShowOperationForm } from '../../panel/operationFormController';
import { validateWorktreeForm, worktreeCreateForm, worktreeFormRequest, type WorktreeFormContext } from '../../panel/operationForms';

export function createWorktreeInForm(
  showOperationForm: ShowOperationForm,
  context: WorktreeFormContext,
  create: (request: WorktreeCreateRequest) => Promise<void>,
): Promise<boolean> {
  return showOperationForm(worktreeCreateForm(context), {
    validate: (values) => validateWorktreeForm(values, context),
    async pick(_field, values) {
      const chosen = await vscode.window.showOpenDialog({
        title: l10n.t('Folder for the new worktree'),
        canSelectFolders: true, canSelectFiles: false, canSelectMany: false,
        defaultUri: vscode.Uri.file(worktreeBrowseStart(context.repoRoot, String(values.path))),
      });
      const folder = chosen?.[0]?.fsPath;
      if (!folder) { return undefined; }
      if (validateWorktreeDestination(context.repoRoot, folder, context.worktrees) === WORKTREE_NONEMPTY_FOLDER) {
        const basis = context.existingBranch === undefined ? values.newBranch : values.startPoint;
        const nested = path.join(folder, String(basis).trim().replace(/[\\/]+/g, '-') || 'worktree');
        if (!validateWorktreeDestination(context.repoRoot, nested, context.worktrees)) {
          return nested;
        }
      }
      return folder;
    },
    async submit(values) {
      await create(worktreeFormRequest(values, context));
      return true;
    },
  });
}

export async function confirmOpenWorktree(worktreePath: string): Promise<boolean> {
  const choice = await vscode.window.showInformationMessage(
    l10n.t('Open {0} in a new window?', worktreePath),
    { modal: true },
    l10n.t('Open Folder'),
  );
  return choice === l10n.t('Open Folder');
}

export async function confirmDeleteWorktree(
  worktreePath: string,
): Promise<'delete' | 'submodules' | null> {
  const choice = await vscode.window.showWarningMessage(
    l10n.t('Delete worktree {0}?', worktreePath),
    { modal: true },
    l10n.t('Delete'),
    l10n.t('Delete and clean up submodules'),
  );
  if (choice === l10n.t('Delete')) {
    return 'delete';
  }
  if (choice === l10n.t('Delete and clean up submodules')) {
    return 'submodules';
  }
  return null;
}
