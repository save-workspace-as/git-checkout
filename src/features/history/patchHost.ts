import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { statSync } from 'node:fs';
import * as path from 'node:path';
import type { CommitPatchService } from './commitPatchService';
import type { CommitPatchFormat } from '../../shared/patches/patchProtocol';
import { copyTextToClipboard } from '../../panel/clipboardHost';
import type { OperationFormErrors } from '../../shared/forms/operationForm';
import type { ShowOperationForm } from '../../panel/operationFormController';
import { applyPatchForm } from '../../panel/operationForms';
import { defaultPatchFileName } from './commitRangePatch';
import { createLogger } from '../../log';

const log = createLogger('patch');

export async function copyCommitPatch(produce: () => Promise<string>): Promise<void> {
  try {
    const text = await produce();
    await copyTextToClipboard(text);
  } catch (error) {
    showPatchError(error);
  }
}

export async function saveCommitPatch(
  rangeLabel: string,
  format: CommitPatchFormat,
  produce: () => Promise<string>,
): Promise<void> {
  try {
    const text = await produce();
    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(defaultPatchFileName(rangeLabel, format)),
      filters: { Patch: ['patch', 'diff'] },
    });
    if (!uri) {
      return;
    }
    await vscode.workspace.fs.writeFile(uri, Buffer.from(text, 'utf8'));
    void vscode.window.showInformationMessage(l10n.t('Saved patch to {0}', uri.fsPath));
  } catch (error) {
    showPatchError(error);
  }
}

export async function applyPatchFromClipboard(
  service: CommitPatchService,
  repoRoot: string,
): Promise<void> {
  const text = await vscode.env.clipboard.readText();
  if (!text.trim()) {
    void vscode.window.showWarningMessage(l10n.t('Clipboard is empty.'));
    return;
  }
  try {
    await service.applyFromText(repoRoot, text);
    void vscode.window.showInformationMessage(l10n.t('Patch applied.'));
  } catch (error) {
    showPatchError(error);
  }
}

/** Opens the Apply Patch form; resolves once it closes. */
export function applyPatchInForm(
  showOperationForm: ShowOperationForm,
  service: CommitPatchService,
  repoRoot: string,
  afterApply: () => Promise<void>,
): Promise<boolean> {
  const readPatch = async (location: string): Promise<string> => {
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(location));
    return Buffer.from(bytes).toString('utf8');
  };
  return showOperationForm(applyPatchForm(), {
    validate: (values): OperationFormErrors =>
      isPatchFile(String(values.location)) ? {} : { location: l10n.t('Choose an existing file.') },
    async pick(_field, values) {
      const current = String(values.location).trim();
      const chosen = await vscode.window.showOpenDialog({
        title: l10n.t('Patch file'),
        canSelectMany: false,
        filters: { Patch: ['patch', 'diff'] },
        defaultUri: current ? vscode.Uri.file(path.dirname(current)) : undefined,
      });
      return chosen?.[0]?.fsPath;
    },
    async noticeAfterPick(_field, value) {
      try {
        const problem = await service.checkApply(repoRoot, await readPatch(value));
        return problem
          ? { kind: 'warning', message: problem }
          : { kind: 'success', message: l10n.t('Patch can be applied without conflicts') };
      } catch (error) {
        log.warn('could not read the patch to check it', error);
        return { kind: 'warning', message: l10n.t('Could not read the patch file.') };
      }
    },
    async submit(values) {
      const text = await readPatch(String(values.location).trim());
      if (!text.trim()) {
        throw new Error(l10n.t('The patch file is empty.'));
      }
      // Applying with a three-way merge would leave conflict markers in the files; refuse before that.
      const problem = await service.checkApply(repoRoot, text);
      if (problem) {
        throw new Error(problem);
      }
      await service.applyFromText(repoRoot, text, values.createCommit === true);
      await afterApply();
      void vscode.window.showInformationMessage(l10n.t('Patch applied.'));
      return true;
    },
  });
}

function isPatchFile(location: string): boolean {
  try {
    return statSync(location.trim()).isFile();
  } catch (error) {
    log.debug('patch location is not a file', error);
    return false;
  }
}

function showPatchError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  log.error(`patch operation failed: ${message}`, error);
  void vscode.window.showErrorMessage(message);
}
