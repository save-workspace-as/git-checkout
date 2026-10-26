import * as l10n from '@vscode/l10n';
import * as path from 'path';
import * as vscode from 'vscode';
import { GitCliError } from '../../core/gitCliError';
import { planWorktreeOpen } from './worktreeOpen';
import { formatWorktreeCreatedMessage, parseWorktreeCreateArg } from './worktreeCreate';
import { createLogger } from '../../log';
import type { WorktreeCreateRequest } from '../../shared/worktrees/worktreeProtocol';
import { copyTextToClipboard } from '../../panel/clipboardHost';
import { readBranchNameSeparator, readBranchWhitespaceReplacement } from '../branches/branchCreateHost';
import { confirmDeleteWorktree, confirmOpenWorktree, createWorktreeInForm } from './worktreeHost';
import type { GitCheckoutPanelManager } from '../../panel/gitCheckoutPanelManager';

const log = createLogger('worktrees');

/** What WorktreeController needs from the window that owns it. */
export type WorktreeContext = Pick<
  GitCheckoutPanelManager,
  | '_onDidChangeRefs'
  | 'activeRepoRoot'
  | 'createOrReveal'
  | 'graphReady'
  | 'operationForm'
  | 'refsService'
  | 'worktreeService'
>;

export class WorktreeController {
  constructor(private readonly ctx: WorktreeContext) {}

  async runCreateWorktree(arg?: unknown): Promise<void> {
    const root = this.ctx.activeRepoRoot();
    if (!root || !this.ctx.graphReady()) {
      void vscode.window.showWarningMessage(l10n.t('No Git repository is open.'));
      return;
    }
    const snapshot = await this.ctx.refsService.loadSnapshot(root);
    const worktrees = await this.ctx.worktreeService.list(root).catch((error: unknown) => {
      log.warn('worktree list failed', error);
      return [];
    });
    const branches = snapshot.branches.map((branch) => branch.name);
    const parsed = parseWorktreeCreateArg(arg, { repoRoot: root, branchNames: branches, worktrees });
    if (parsed.status === 'invalid') {
      void vscode.window.showWarningMessage(parsed.message);
      return;
    }
    let request: WorktreeCreateRequest | undefined = parsed.status === 'ready' ? parsed.request : undefined;
    const created = parsed.status === 'ready'
      ? await this.runWorktree(l10n.t('Creating worktree'), (repoRoot) => this.ctx.worktreeService.add(repoRoot, parsed.request))
      : await createWorktreeInForm(this.ctx.operationForm.show, {
            repoRoot: root,
            currentBranch: snapshot.headRef,
            branchNames: branches,
            refs: [
              ...snapshot.remoteBranches.map((branch) => branch.name).filter((name) => !name.endsWith('/HEAD')),
              ...snapshot.tags.map((tag) => `refs/tags/${tag.name}`),
            ],
            worktrees,
            prefill: {
              currentBranch: snapshot.headRef,
              separator: readBranchNameSeparator(),
            },
            whitespaceReplacement: readBranchWhitespaceReplacement(),
          }, async (resolved) => {
            await this.ctx.worktreeService.add(root, resolved);
            request = resolved;
          });
    if (!created || !request) {
      return;
    }
    if (parsed.status !== 'ready') {
      this.ctx._onDidChangeRefs.fire();
    }
    const destination = path.resolve(root, request.path);
    void vscode.window
      .showInformationMessage(formatWorktreeCreatedMessage(request), l10n.t('Open Folder'))
      .then((choice) => {
        if (choice === l10n.t('Open Folder')) {
          return this.runOpenWorktree(destination);
        }
        return undefined;
      });
  }

  async runOpenWorktree(worktreePath: string): Promise<void> {
    const folders = vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) ?? [];
    const plan = planWorktreeOpen(worktreePath, folders);
    if (plan.action === 'reveal') {
      this.ctx.createOrReveal();
      return;
    }
    if (!(await confirmOpenWorktree(plan.path))) {
      return;
    }
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(plan.path), {
      forceNewWindow: true,
    });
  }

  async runRevealWorktree(worktreePath: string): Promise<void> {
    await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(worktreePath));
  }

  runCopyWorktreePath(worktreePath: string): Promise<void> {
    return copyTextToClipboard(worktreePath);
  }

  async runCheckoutAsWorktree(branchName: string): Promise<void> {
    const root = this.ctx.activeRepoRoot();
    if (!root || !this.ctx.graphReady()) {
      void vscode.window.showWarningMessage(l10n.t('No Git repository is open.'));
      return;
    }
    const snapshot = await this.ctx.refsService.loadSnapshot(root);
    const worktrees = await this.ctx.worktreeService.list(root).catch((error: unknown) => {
      log.warn('worktree list failed', error);
      return [];
    });
    const branches = snapshot.branches.map((b) => b.name);
    const existingRef = `refs/heads/${branchName}`;
    if (worktrees.some((w) => w.branch === existingRef)) {
      void vscode.window.showWarningMessage(
        l10n.t('Branch "{0}" is already checked out in a worktree.', branchName),
      );
      return;
    }
    let request: WorktreeCreateRequest | undefined;
    const created = await createWorktreeInForm(this.ctx.operationForm.show, {
      repoRoot: root,
      currentBranch: snapshot.headRef,
      branchNames: branches,
      existingBranch: branchName,
      refs: [
        ...snapshot.remoteBranches
          .map((branch) => branch.name)
          .filter((name) => !name.endsWith('/HEAD')),
        ...snapshot.tags.map((tag) => `refs/tags/${tag.name}`),
      ],
      worktrees,
    }, async (resolved) => {
      await this.ctx.worktreeService.add(root, resolved);
      request = resolved;
    });
    if (!created || !request) {
      return;
    }
    this.ctx._onDidChangeRefs.fire();
    const destination = path.resolve(root, request.path);
    void vscode.window
      .showInformationMessage(formatWorktreeCreatedMessage(request), l10n.t('Open Folder'))
      .then((choice) => {
        if (choice === l10n.t('Open Folder')) {
          return this.runOpenWorktree(destination);
        }
        return undefined;
      });
  }

  async runDeleteWorktree(worktreePath: string): Promise<void> {
    const root = this.ctx.activeRepoRoot();
    if (!root || !this.ctx.graphReady()) {
      void vscode.window.showWarningMessage(l10n.t('No Git repository is open.'));
      return;
    }
    if (planWorktreeOpen(worktreePath, [root]).action === 'reveal') {
      void vscode.window.showWarningMessage(l10n.t('The current worktree stays open in this window.'));
      return;
    }
    const choice = await confirmDeleteWorktree(worktreePath);
    if (!choice) {
      return;
    }
    await this.runWorktree(l10n.t('Deleting worktree'), (repoRoot) =>
      this.ctx.worktreeService.remove(repoRoot, worktreePath, choice === 'submodules'),
    );
  }

  private async runWorktree(title: string, op: (repoRoot: string) => Promise<void>): Promise<boolean> {
    const root = this.ctx.activeRepoRoot();
    if (!root || !this.ctx.graphReady()) {
      void vscode.window.showWarningMessage(l10n.t('No Git repository is open.'));
      return false;
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
      return false;
    }
    this.ctx._onDidChangeRefs.fire();
    return true;
  }
}
