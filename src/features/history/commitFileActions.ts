import * as l10n from '@vscode/l10n';
import { posix } from 'node:path';
import * as vscode from 'vscode';

import { openExternalTool } from '../../extensibility/externalToolHost';
import type { GitCli } from '../../core/gitCli';
import { createLogger } from '../../log';
import { commitFileTarget, openRevision, resetSources, type CommitFileTarget } from '../../shared/history/commitFileActions';

const log = createLogger('commit-file');

export type CommitFileAction =
  | 'open'
  | 'openDiff'
  | 'externalDiff'
  | 'showInFinder'
  | 'resetToCommit'
  | 'resetToBeforeCommit'
  | 'saveAs'
  | 'copyPath';

export interface CommitFileHost {
  repoRoot(): string | null;
  cli(repoRoot: string): GitCli;
  /** Opens the change in a diff editor. */
  openChange(target: CommitFileTarget): Promise<void>;
  /** Opens the file as it was at `revision`. */
  openAtRevision(revision: string, path: string): Promise<void>;
  refreshWorkingCopy(): Promise<void>;
}

/** Actions on a file in the Changes and Tree lists' context menu. */
export class CommitFileActions {
  constructor(private readonly host: CommitFileHost) {}

  async run(action: CommitFileAction, arg: unknown): Promise<void> {
    const target = commitFileTarget(arg);
    const root = this.host.repoRoot();
    if (!target || !root) {
      void vscode.window.showWarningMessage(l10n.t('Select a file in a repository first.'));
      return;
    }
    const working = vscode.Uri.file(posix.join(root.replace(/\\/g, '/'), target.path));
    try {
      switch (action) {
        case 'open': {
          const version = openRevision(target);
          await this.host.openAtRevision(version.revision, version.path);
          break;
        }
        case 'openDiff':
          await this.host.openChange(target);
          break;
        case 'externalDiff':
          await openExternalTool(
            'diff',
            working,
            undefined,
            [resetSources(target).beforeCommit.revision, target.revision],
          );
          break;
        case 'showInFinder':
          await vscode.commands.executeCommand('revealFileInOS', working);
          break;
        case 'resetToCommit':
          await this.reset(root, target, resetSources(target).atCommit, l10n.t('its state at {0}', short(target.revision)));
          break;
        case 'resetToBeforeCommit':
          await this.reset(root, target, resetSources(target).beforeCommit, l10n.t('its state before {0}', short(target.revision)));
          break;
        case 'saveAs':
          await this.saveAs(root, target);
          break;
        case 'copyPath':
          await vscode.env.clipboard.writeText(target.path);
          break;
      }
    } catch (error) {
      log.error(`file action ${action} failed`, error);
      void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }

  private async reset(
    root: string,
    target: CommitFileTarget,
    source: { revision: string; path: string },
    description: string,
  ): Promise<void> {
    const confirm = l10n.t('Reset File');
    const answer = await vscode.window.showWarningMessage(
      l10n.t('Reset {0} to {1}?', target.path, description),
      { modal: true, detail: l10n.t('Uncommitted changes to this file in your working tree will be replaced.') },
      confirm,
    );
    if (answer !== confirm) {
      return;
    }
    const cli = this.host.cli(root);
    await cli.execWrite(['checkout', source.revision, '--', source.path]);
    await this.host.refreshWorkingCopy();
    log.info(`reset ${source.path} to ${source.revision}`);
  }

  private async saveAs(root: string, target: CommitFileTarget): Promise<void> {
    const result = await this.host
      .cli(root)
      .execRead(['show', `${target.revision}:${target.path}`], { binaryStdout: true });
    const destination = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(posix.join(root.replace(/\\/g, '/'), posix.basename(target.path))),
      title: l10n.t('Save {0} at {1}', target.path, short(target.revision)),
    });
    if (!destination) {
      return;
    }
    await vscode.workspace.fs.writeFile(destination, result.stdoutBytes ?? new Uint8Array());
    log.info(`saved ${target.path} at ${target.revision}`);
  }
}

function short(revision: string): string {
  return /^[0-9a-f]{40,64}$/i.test(revision) ? revision.slice(0, 7) : revision;
}
