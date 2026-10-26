import * as l10n from '@vscode/l10n';
import * as path from 'path';
import * as vscode from 'vscode';
import { GitCliError } from '../../core/gitCliError';
import { planSubmoduleOpen } from './submoduleOpen';
import { createLogger } from '../../log';
import { type WorkingCopyDiffSide } from '../../shared/changes/workingCopyProtocol';
import { copyTextToClipboard } from '../../panel/clipboardHost';
import { openTerminalForRepo } from '../../panel/repoTerminal';
import { confirmDeleteSubmodule, confirmOpenSubmodule, openSubmoduleInWorkspace } from './submoduleHost';
import { submoduleAddForm, submoduleFormRequest, validateSubmoduleForm } from '../../panel/operationForms';
import type { GitCheckoutPanelManager } from '../../panel/gitCheckoutPanelManager';

const log = createLogger('submodules');

/** What SubmoduleController needs from the window that owns it. */
export type SubmoduleContext = Pick<
  GitCheckoutPanelManager,
  | '_onDidChangeRefs'
  | 'activeRepoRoot'
  | 'changes'
  | 'createOrReveal'
  | 'graphReady'
  | 'operationForm'
  | 'panel'
  | 'panelTitle'
  | 'postState'
  | 'postWhenReady'
  | 'selectedRepoRoot'
  | 'showLocalChanges'
  | 'submoduleService'
>;

export class SubmoduleController {
  constructor(private readonly ctx: SubmoduleContext) {}

  async runAddSubmodule(): Promise<void> {
    const root = this.ctx.activeRepoRoot();
    if (!root || !this.ctx.graphReady()) {
      void vscode.window.showWarningMessage(l10n.t('No Git repository is open.'));
      return;
    }
    const added = await this.ctx.operationForm.show(submoduleAddForm(), {
      validate: validateSubmoduleForm,
      submit: async (values) => {
        await this.ctx.submoduleService.add(root, submoduleFormRequest(values));
        return true;
      },
    });
    if (added) {
      this.ctx._onDidChangeRefs.fire();
      await this.ctx.changes.sendWorkingCopySnapshot();
      await this.ctx.postState('state');
    }
  }

  runInitSubmodules(paths: readonly string[] = []): Promise<void> {
    return this.runSubmodule(l10n.t('Initializing submodules'), (repoRoot) =>
      this.ctx.submoduleService.init(repoRoot, paths),
    );
  }

  runUpdateSubmodules(paths: readonly string[] = []): Promise<void> {
    return this.runSubmodule(l10n.t('Updating submodules'), (repoRoot) =>
      this.ctx.submoduleService.update(repoRoot, paths),
    );
  }

  runSyncSubmodules(paths: readonly string[] = []): Promise<void> {
    return this.runSubmodule(l10n.t('Syncing submodules'), (repoRoot) =>
      this.ctx.submoduleService.sync(repoRoot, paths),
    );
  }

  async runOpenSubmodule(relPath: string, initialize = false): Promise<void> {
    const root = this.ctx.activeRepoRoot();
    if (!root || !this.ctx.graphReady()) {
      void vscode.window.showWarningMessage(l10n.t('No Git repository is open.'));
      return;
    }
    if (initialize) {
      try {
        await this.ctx.submoduleService.init(root, [relPath]);
      } catch (error) {
        const message = error instanceof GitCliError ? `${error.code}: ${error.message}` : String(error);
        log.error(`init submodule failed: ${message}`, error);
        void vscode.window.showErrorMessage(message);
        return;
      }
    }
    const absolute = path.resolve(root, relPath);
    const folders = vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) ?? [];
    const plan = planSubmoduleOpen(absolute, folders);
    if (plan.action === 'openFolder') {
      if (!(await confirmOpenSubmodule(plan.path))) {
        return;
      }
      await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(plan.path), {
        forceNewWindow: true,
      });
      return;
    }
    if (!openSubmoduleInWorkspace(plan.path)) {
      void vscode.window.showErrorMessage(l10n.t("Could not open {0} in this window.", plan.path));
      return;
    }
    this.ctx.selectedRepoRoot = plan.path;
    if (this.ctx.panel) {
      this.ctx.panel.title = this.ctx.panelTitle();
    }
    this.ctx.createOrReveal();
    await this.ctx.postState('state');
    this.ctx._onDidChangeRefs.fire();
  }

  runCopySubmodulePath(relPath: string): Promise<void> {
    const root = this.ctx.activeRepoRoot();
    if (!root) {
      void vscode.window.showWarningMessage(l10n.t('No Git repository is open.'));
      return Promise.resolve();
    }
    return copyTextToClipboard(path.resolve(root, relPath));
  }

  runOpenSubmoduleInTerminal(relPath: string): void {
    const root = this.ctx.activeRepoRoot();
    openTerminalForRepo(root ? path.resolve(root, relPath) : null);
  }

  async runRevealSubmodule(relPath: string): Promise<void> {
    const root = this.ctx.activeRepoRoot();
    if (!root) {
      void vscode.window.showWarningMessage(l10n.t('No Git repository is open.'));
      return;
    }
    await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(path.resolve(root, relPath)));
  }

  async runDeleteSubmodule(relPath: string): Promise<void> {
    if (!(await confirmDeleteSubmodule(relPath))) {
      return;
    }
    await this.runSubmodule(l10n.t('Deleting submodule'), (repoRoot) =>
      this.ctx.submoduleService.remove(repoRoot, relPath),
    );
  }

  showSubmoduleDiff(relPath: string, side: WorkingCopyDiffSide): void {
    this.ctx.createOrReveal();
    this.ctx.showLocalChanges();
    this.ctx.postWhenReady({ type: 'workingCopyRevealDiff', path: relPath, side });
  }

  private async runSubmodule(title: string, op: (repoRoot: string) => Promise<void>): Promise<void> {
    const root = this.ctx.activeRepoRoot();
    if (!root || !this.ctx.graphReady()) {
      void vscode.window.showWarningMessage(l10n.t('No Git repository is open.'));
      return;
    }
    try {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: l10n.t('Git Checkout: {0}', title) },
        () => op(root),
      );
    } catch (error) {
      const message = error instanceof GitCliError ? `${error.code}: ${error.message}` : String(error);
      log.error(`${title} failed: ${message}`, error);
      void vscode.window.showErrorMessage(message);
      return;
    }
    this.ctx._onDidChangeRefs.fire();
    await this.ctx.changes.sendWorkingCopySnapshot();
    await this.ctx.postState('state');
  }
}
