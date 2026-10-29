import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ConflictResolutionService } from '../conflicts/conflictResolutionService';
import { createLogger } from '../../log';
import type { GitCheckoutPanelManager } from '../../panel/gitCheckoutPanelManager';
import type { HistoryWebviewMessage } from '../../shared/history/historyProtocol';

const log = createLogger('operation');

/** What OperationController needs from the window that owns it. */
export type OperationContext = Pick<
  GitCheckoutPanelManager,
  | '_onDidChangeRefs'
  | 'activeRepoRoot'
  | 'cliRegistry'
  | 'gitService'
  | 'handleOpError'
  | 'merge'
  | 'postState'
  | 'reloadGraphOnHeadChange'
  | 'repoOperationService'
>;

/** Handles the banner that stays above the graph while a merge, rebase, cherry-pick or revert is unfinished. */
export class OperationController {
  private service: ConflictResolutionService | undefined;

  constructor(private readonly ctx: OperationContext) {}

  /** Made on first use: the window creates this controller before it has its Git services. */
  private get conflicts(): ConflictResolutionService {
    this.service ??= new ConflictResolutionService(this.ctx.gitService, this.ctx.cliRegistry);
    return this.service;
  }

  async handleWebviewMessage(
    message: Extract<HistoryWebviewMessage, { type: 'operationResolve' | 'operationContinue' | 'operationAbort' }>,
  ): Promise<void> {
    switch (message.type) {
      case 'operationResolve':
        return this.resolve();
      case 'operationContinue':
        return this.continue();
      case 'operationAbort':
        return this.abort();
    }
  }

  /** Opens the next conflicted file in the Merge modal; the user fixes it there and it is staged. */
  async resolve(): Promise<void> {
    const root = this.ctx.activeRepoRoot();
    if (!root) {
      return;
    }
    try {
      const state = await this.conflicts.loadState(root);
      const file = state.files.find((f) => f.mergeEditorSupported);
      if (file) {
        this.ctx.merge.open(file.path);
        return;
      } else if (state.files[0]) {
        // Deleted on one side, a binary file or a submodule: the merge editor cannot show it.
        void vscode.window.showInformationMessage(state.files[0].guidance);
      }
      await vscode.commands.executeCommand('workbench.view.scm');
    } catch (error) {
      log.error('could not open the conflicts', error);
      await this.ctx.handleOpError(root, error);
    }
  }

  async continue(): Promise<void> {
    await this.run(async (root) => {
      switch (await this.conflicts.continue(root)) {
        case 'stopped':
          void vscode.window.showInformationMessage(l10n.t('Stopped at the next commit, which has conflicts. Fix them and continue.'));
          break;
        case 'unresolved':
          void vscode.window.showInformationMessage(l10n.t('Fix the remaining conflicts and stage the files before continuing.'));
          break;
        case 'finished':
          break;
      }
    });
  }

  async abort(): Promise<void> {
    const root = this.ctx.activeRepoRoot();
    if (!root) {
      return;
    }
    const operation = await this.ctx.repoOperationService.getStatus(root);
    const abort = l10n.t('Abort');
    const choice = await vscode.window.showWarningMessage(
      l10n.t('Abort this operation? Git discards what it has done so far and returns the branch to where it started.'),
      { modal: true, detail: operation.summary || undefined },
      abort,
    );
    if (choice !== abort) {
      return;
    }
    await this.run((repoRoot) => this.conflicts.abort(repoRoot));
  }

  private async run(action: (repoRoot: string) => Promise<void>): Promise<void> {
    const root = this.ctx.activeRepoRoot();
    if (!root) {
      return;
    }
    try {
      await action(root);
    } catch (error) {
      await this.ctx.handleOpError(root, error);
    } finally {
      await this.ctx.postState('state');
      this.ctx._onDidChangeRefs.fire();
      void this.ctx.reloadGraphOnHeadChange();
    }
  }
}
