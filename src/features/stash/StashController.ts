import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { GitCliError } from '../../core/gitCliError';
import { parseStashCreateArg } from './stashOptions';
import { createLogger } from '../../log';
import type { OperationFormDefinition, OperationFormValues } from '../../shared/forms/operationForm';
import { type StashEntryDto } from '../../shared/stash/stashProtocol';
import { type WorkingCopyPatchAction } from '../../shared/changes/workingCopyProtocol';
import { createPatchInForm } from '../history/patchHost';
import { confirmStashClear, confirmStashDrop, confirmStashPop, openStashPatch, createStashInForm, promptStashMessage } from './stashHost';
import { applyStashForm, deleteStashForm, renameStashForm } from '../../panel/operationForms';
import type { GitCheckoutPanelManager } from '../../panel/gitCheckoutPanelManager';

const log = createLogger('stash');

/** What StashController needs from the window that owns it. */
export type StashContext = Pick<
  GitCheckoutPanelManager,
  | '_onDidChangeRefs'
  | 'activeRepoRoot'
  | 'changes'
  | 'commitPatchService'
  | 'graphReady'
  | 'operationForm'
  | 'patchStagingService'
  | 'postMessage'
  | 'postState'
  | 'refsService'
  | 'reloadGraphOnHeadChange'
  | 'stashService'
  | 'workingTreeService'
>;

export class StashController {
  constructor(private readonly ctx: StashContext) {}

  async runCreateStash(arg?: unknown): Promise<void> {
    const parsed = parseStashCreateArg(arg);
    if (parsed.status === 'invalid') {
      void vscode.window.showWarningMessage(parsed.message);
      return;
    }
    const root = this.ctx.activeRepoRoot();
    if (!root || !this.ctx.graphReady()) {
      void vscode.window.showWarningMessage(l10n.t('No Git repository is open.'));
      return;
    }
    if (parsed.status === 'ready') {
      await this.runStash(l10n.t('Stashing'), (repoRoot) => this.ctx.stashService.create(repoRoot, parsed.request));
      return;
    }
    const saved = await createStashInForm(
      this.ctx.operationForm.show,
      (await this.ctx.workingTreeService.loadSnapshot(root)).entries.map((entry) => entry.path),
      (request) => this.ctx.stashService.create(root, request),
      {
        currentBranch: (await this.ctx.refsService.loadSnapshot(root)).headRef ?? '',
        load: () => this.ctx.stashService.list(root),
      },
    );
    if (saved) {
      this.ctx._onDidChangeRefs.fire();
      await this.ctx.changes.sendWorkingCopySnapshot();
      await this.ctx.postState('state');
      void this.ctx.reloadGraphOnHeadChange();
    }
  }

  runApplyStash(selector: string): Promise<void> {
    return this.runStashFormForStash(selector, applyStashForm, async (repoRoot, stash, values) => {
      await this.ctx.stashService.apply(repoRoot, selector, true);
      if (values.deleteAfter === true) {
        await this.ctx.stashService.drop(repoRoot, [selector]);
      }
    });
  }

  runRenameStash(selector: string): Promise<void> {
    return this.runStashFormForStash(selector, renameStashForm, async (repoRoot, stash, values) => {
      await this.ctx.stashService.rename(repoRoot, stash.selector, String(values.message));
    });
  }

  /** Opens the Create Patch form on the stash, as a plain diff: a stash is a merge, which has no patch of its own. */
  async runSaveStashPatch(selector: string): Promise<void> {
    const found = await this.findStash(selector);
    if (found) {
      await createPatchInForm(this.ctx.operationForm.show, this.ctx.commitPatchService, found.root, {
        revision: found.stash.sha,
        format: 'diff',
      });
    }
  }

  async runPopStash(selector: string): Promise<void> {
    if (!(await confirmStashPop(selector))) {
      return;
    }
    await this.runStash(l10n.t('Popping stash'), (repoRoot) => this.ctx.stashService.pop(repoRoot, selector));
  }

  async runDropStashes(selectors: readonly string[]): Promise<void> {
    if (selectors.length === 0) {
      return;
    }
    if (selectors.length === 1) {
      await this.runStashFormForStash(selectors[0], deleteStashForm, async (repoRoot, stash) => {
        await this.ctx.stashService.drop(repoRoot, [stash.selector]);
      });
      return;
    }
    if (!(await confirmStashDrop(selectors))) {
      return;
    }
    await this.runStash(l10n.t('Dropping stash'), (repoRoot) => this.ctx.stashService.drop(repoRoot, selectors));
  }

  async runClearStashes(): Promise<void> {
    if (!(await confirmStashClear())) {
      return;
    }
    await this.runStash(l10n.t('Clearing stashes'), (repoRoot) => this.ctx.stashService.clear(repoRoot));
  }

  async runShowStash(selector: string): Promise<void> {
    const root = this.ctx.activeRepoRoot();
    if (!root || !this.ctx.graphReady()) {
      void vscode.window.showWarningMessage(l10n.t('No Git repository is open.'));
      return;
    }
    try {
      await openStashPatch(await this.ctx.stashService.showPatch(root, selector));
    } catch (error) {
      const message = error instanceof GitCliError ? `${error.code}: ${error.message}` : String(error);
      log.error(`show stash failed: ${message}`, error);
      void vscode.window.showErrorMessage(message);
    }
  }

  async stashWorkingCopyPath(filePath: string): Promise<void> {
    const message = await promptStashMessage();
    if (message === null) {
      return;
    }
    await this.runStash(l10n.t('Stashing'), (repoRoot) =>
      this.ctx.stashService.create(repoRoot, { mode: 'paths', message, paths: [filePath] }),
    );
  }

  async stashSelection(
    action: Extract<WorkingCopyPatchAction, { op: 'stashHunk' | 'stashLine' }>,
  ): Promise<void> {
    const root = this.ctx.activeRepoRoot();
    if (!root || !this.ctx.graphReady()) {
      void vscode.window.showWarningMessage(l10n.t('No Git repository is open.'));
      return;
    }
    const message = await promptStashMessage();
    if (message === null) {
      return;
    }
    try {
      const patch = await this.ctx.patchStagingService.selectionPatch(root, action);
      await this.runStash(l10n.t('Stashing'), (repoRoot) =>
        this.ctx.stashService.create(repoRoot, { mode: 'patch', message, patch, side: action.side }),
      );
    } catch (error) {
      const text = error instanceof GitCliError ? `${error.code}: ${error.message}` : String(error);
      log.error(`stash selection failed: ${text}`, error);
      void vscode.window.showErrorMessage(text);
      return;
    }
    await this.ctx.changes.sendWorkingCopyFileDiff(action.path, action.side);
  }

  /** The active repository and the stash entry for `selector`, after telling the person why there is none. */
  private async findStash(selector: string): Promise<{ root: string; stash: StashEntryDto } | undefined> {
    const root = this.ctx.activeRepoRoot();
    if (!root || !this.ctx.graphReady()) {
      void vscode.window.showWarningMessage(l10n.t('No Git repository is open.'));
      return undefined;
    }
    let stash: StashEntryDto | undefined;
    try {
      stash = (await this.ctx.stashService.list(root)).find((entry) => entry.selector === selector);
    } catch (error) {
      log.error('loading stash for operation failed', error);
      void vscode.window.showErrorMessage(
        error instanceof Error ? error.message : String(error),
      );
      return undefined;
    }
    if (!stash) {
      void vscode.window.showWarningMessage(l10n.t('Stash no longer exists.'));
      return undefined;
    }
    return { root, stash };
  }

  private async runStashFormForStash(
    selector: string,
    form: (stash: StashEntryDto) => OperationFormDefinition,
    submit: (repoRoot: string, stash: StashEntryDto, values: OperationFormValues) => Promise<void>,
  ): Promise<void> {
    const found = await this.findStash(selector);
    if (!found) {
      return;
    }
    const { root, stash } = found;
    await this.ctx.operationForm.show(form(stash), {
      validate: () => ({}),
      submit: (values) => this.runStashAtRoot(
        l10n.t('Updating stash'), root, () => submit(root, stash, values),
      ),
    });
  }

  private async runStash(
    title: string,
    op: (repoRoot: string) => Promise<void>,
    repoRoot = this.ctx.activeRepoRoot(),
  ): Promise<boolean> {
    const root = repoRoot;
    if (!root || !this.ctx.graphReady()) {
      void vscode.window.showWarningMessage(l10n.t('No Git repository is open.'));
      return false;
    }
    return this.runStashAtRoot(title, root, op);
  }

  private async runStashAtRoot(
    title: string,
    root: string,
    op: (repoRoot: string) => Promise<void>,
  ): Promise<boolean> {
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
    await this.ctx.changes.sendWorkingCopySnapshot();
    await this.ctx.postState('state');
    void this.ctx.reloadGraphOnHeadChange();
    return true;
  }
}
