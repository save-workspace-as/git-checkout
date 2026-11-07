import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import type { StashCreateRequest, StashEntryDto } from '../../shared/stash/stashProtocol';
import type { OperationFormValues } from '../../shared/forms/operationForm';
import type { ShowOperationForm } from '../../panel/operationFormController';
import { stashCreateForm, stashFileId } from '../../panel/operationForms';
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

const pickedFiles = (files: readonly string[], values: OperationFormValues): string[] =>
  files.filter((_, index) => values[stashFileId(index)] === true);

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
  return showOperationForm(stashCreateForm(unique, suggestions.currentBranch,
    stashes.map((stash) => ({ value: stash.message, label: stash.selector }))), {
    validate: (values) => values.mode === 'paths' && pickedFiles(unique, values).length === 0
      ? { [stashFileId(0)]: l10n.t('Select at least one file to stash.') } : {},
    async submit(values) {
      const message = String(values.message).trim();
      if (values.mode === 'paths') {
        await create({ mode: 'paths', message, paths: pickedFiles(unique, values) });
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
