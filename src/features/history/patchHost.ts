import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import type { CommitPatchService } from './commitPatchService';
import type { CommitPatchFormat } from '../../shared/patches/patchProtocol';
import { copyTextToClipboard } from '../../panel/clipboardHost';
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

function showPatchError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  log.error(`patch operation failed: ${message}`, error);
  void vscode.window.showErrorMessage(message);
}
