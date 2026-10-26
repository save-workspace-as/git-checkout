import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import type { StashCreateRequest, StashEntryDto } from '../../shared/stash/stashProtocol';
import type { ShowOperationForm } from '../../panel/operationFormController';
import { stashCreateForm } from '../../panel/operationForms';
import { createLogger } from '../../log';

const log = createLogger('stash-form');

export async function promptStashMessage(): Promise<string | null> {
  const value = await vscode.window.showInputBox({
    title: l10n.t('Stash'),
    prompt: l10n.t('Stash message'),
    placeHolder: l10n.t('WIP'),
    ignoreFocusOut: true,
  });
  if (value === undefined) {
    return null;
  }
  return value.trim();
}

export async function createStashInForm(
  showOperationForm: ShowOperationForm,
  paths: readonly string[],
  create: (request: StashCreateRequest) => Promise<void>,
  suggestions: { currentBranch: string; load(): Promise<StashEntryDto[]> },
): Promise<boolean> {
  const unique = [...new Set(paths)].sort((a, b) => a.localeCompare(b));
  let stashes: StashEntryDto[];
  try {
    stashes = await suggestions.load();
  } catch (error) {
    log.error('loading stash suggestions failed', error);
    void vscode.window.showErrorMessage(l10n.t('Could not load existing stash messages.'));
    return false;
  }
  return showOperationForm(stashCreateForm(unique.length > 0, suggestions.currentBranch,
    stashes.map((stash) => ({ value: stash.message, label: stash.selector }))), {
    validate: () => ({}),
    async submit(values) {
      const message = String(values.message).trim();
      if (values.mode === 'paths') {
        const picked = await vscode.window.showQuickPick(
          unique.map((path) => ({ label: path })),
          { title: l10n.t('Save Stash'), canPickMany: true, placeHolder: l10n.t('Files to stash'), ignoreFocusOut: true },
        );
        if (!picked || picked.length === 0) {
          return false;
        }
        await create({ mode: 'paths', message, paths: picked.map((item) => item.label) });
      } else {
        await create({ mode: 'all', message, includeUntracked: values.includeUntracked === true });
      }
      return true;
    },
  });
}

export async function confirmStashDrop(selectors: readonly string[]): Promise<boolean> {
  const label = selectors.length === 1 ? selectors[0] : l10n.t('{0} stashes', selectors.length);
  const choice = await vscode.window.showWarningMessage(
    l10n.t('Drop {0}?', label),
    { modal: true },
    l10n.t('Drop'),
  );
  return choice === l10n.t('Drop');
}

export async function confirmStashClear(): Promise<boolean> {
  const choice = await vscode.window.showWarningMessage(
    l10n.t('Drop every stash?'),
    { modal: true },
    l10n.t('Clear'),
  );
  return choice === l10n.t('Clear');
}

export async function confirmStashPop(selector: string): Promise<boolean> {
  const choice = await vscode.window.showWarningMessage(
    l10n.t('Pop {0}? This applies the stash and removes it.', selector),
    { modal: true },
    l10n.t('Pop'),
  );
  return choice === l10n.t('Pop');
}

export async function openStashPatch(patch: string): Promise<void> {
  const doc = await vscode.workspace.openTextDocument({
    content: patch || 'No changes in this stash.\n',
    language: 'diff',
  });
  await vscode.window.showTextDocument(doc, { preview: true });
}
