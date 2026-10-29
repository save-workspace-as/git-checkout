import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import * as path from 'node:path';
import { type GitFlowRunResult } from '../gitflow/gitFlowService';
import { checkMergePreflight } from '../branches/mergePreflight';
import type { ResetMode } from './historyService';
import { createLogger } from '../../log';
import type { CommitPatchFormat, PatchExportOp } from '../../shared/patches/patchProtocol';
import { promptCheckoutRef, runCheckoutWithFfPrompt } from '../branches/checkoutHost';
import { runCommitFlow } from '../changes/commitHost';
import { executeGitFlow } from '../gitflow/gitFlowHost';
import { executeSigningToggle } from '../signing/signingHost';
import { promptHistorySha, runCherryPick, runRangeOp, runRevert } from '../graph/graphHistoryHost';
import { promptBranchDropAction, promptIntegrateRef, runMergeIntoHead, runRebaseOnto } from '../branches/integrateHost';
import { promptResetTarget } from '../branches/resetHost';
import { archiveArgs, defaultArchiveName } from './archive';
import { applyPatchFromClipboard, applyPatchInForm, copyCommitPatch, createPatchInForm } from './patchHost';
import { buildBranchCommitRange, buildRangeFromOrderedShas } from './commitRangePatch';
import { MERGE_TYPE_FAST_FORWARD, mergeForm, rebaseForm, resetForm } from '../../panel/operationForms';
import type { GitCheckoutPanelManager } from '../../panel/gitCheckoutPanelManager';

const log = createLogger('history');

/** What HistoryOperationsController needs from the window that owns it. */
export type HistoryOperationsContext = Pick<
  GitCheckoutPanelManager,
  | '_onDidChangeRefs'
  | 'activeBranchCompare'
  | 'activeRepoRoot'
  | 'changes'
  | 'checkoutService'
  | 'cliRegistry'
  | 'commitPatchService'
  | 'commitService'
  | 'context'
  | 'createOrReveal'
  | 'gitFlowService'
  | 'gitSettings'
  | 'graph'
  | 'graphReady'
  | 'historyService'
  | 'integrationService'
  | 'interactiveRebase'
  | 'operationForm'
  | 'postState'
  | 'refsService'
  | 'reloadGraphOnHeadChange'
  | 'repoOperationService'
  | 'submoduleService'
  | 'sync'
  | 'workingTreeService'
>;

export class HistoryOperationsController {
  constructor(private readonly ctx: HistoryOperationsContext) {}

  runCommit(): Promise<void> {
    return this.ctx.sync.runSyncOp(l10n.t('Commit'), async (root, _token) => {
      const ok = await runCommitFlow(
        this.ctx.context,
        root,
        this.ctx.commitService,
        this.ctx.workingTreeService,
      );
      if (!ok) {
        return;
      }
    });
  }

  runGitFlow(arg?: unknown): Promise<GitFlowRunResult | undefined> {
    const root = this.ctx.activeRepoRoot();
    if (!root || !this.ctx.graphReady()) {
      void vscode.window.showWarningMessage(l10n.t('No Git repository is open.'));
      return Promise.resolve(undefined);
    }
    return executeGitFlow(this.ctx.gitFlowService, root, arg, this.ctx.operationForm.show).then(async (result) => {
      if (result?.ran) {
        this.ctx._onDidChangeRefs.fire();
        await this.ctx.changes.sendWorkingCopySnapshot();
        await this.ctx.postState('state');
      }
      return result;
    });
  }

  runToggleSigning(arg?: unknown): Promise<boolean | undefined> {
    const root = this.ctx.activeRepoRoot();
    if (!root || !this.ctx.graphReady()) {
      void vscode.window.showWarningMessage(l10n.t('No Git repository is open.'));
      return Promise.resolve(undefined);
    }
    return executeSigningToggle(this.ctx.commitService, root, arg);
  }

  async runCheckout(ref: string, localBranch = false): Promise<void> {
    await this.ctx.sync.runSyncOp(l10n.t('Checking out'), async (root, token) => {
      await runCheckoutWithFfPrompt(this.ctx.checkoutService, root, ref, token, localBranch);
      if (this.ctx.gitSettings.checkoutUpdateSubmodules()) {
        // Submodules follow the commits the checked-out branch records, as `git checkout --recurse-submodules` would.
        await this.ctx.submoduleService.updateIfPresent(root);
      }
    });
  }

  async runMergeRef(ref: string): Promise<void> {
    const root = this.ctx.activeRepoRoot();
    if (!root || !this.ctx.graphReady()) {
      void vscode.window.showWarningMessage(l10n.t('No Git repository is open.'));
      return;
    }
    const operation = await this.ctx.repoOperationService.getStatus(root);
    if (operation.active) {
      void vscode.window.showWarningMessage(
        operation.summary || l10n.t('Finish or abort the in-progress Git operation first.'),
      );
      return;
    }
    const snapshot = await this.ctx.refsService.loadSnapshot(root);
    const preflight = await checkMergePreflight(this.ctx.cliRegistry.getOrCreate(root), ref);
    await this.ctx.operationForm.show(mergeForm(ref, snapshot.headRef ?? 'HEAD', preflight.wouldConflict), {
      validate: () => ({}),
      submit: async (values) => {
        const mergeMode = values.mergeType === MERGE_TYPE_FAST_FORWARD ? 'fastForward' : 'default';
        await this.ctx.sync.runSyncOp(l10n.t('Merge'), (repoRoot, token) =>
          runMergeIntoHead(this.ctx.integrationService, this.ctx.cliRegistry, repoRoot, ref, token, {
            mergeMode,
            preflightConfirmed: true,
          }),
        );
        return true;
      },
    });
  }

  async runMergePrompt(): Promise<void> {
    const ref = await promptIntegrateRef('merge');
    if (!ref) {
      return;
    }
    await this.runMergeRef(ref);
  }

  async runRebaseRef(
    ref: string,
    sourceBranch?: string,
    beforeRebase?: (repoRoot: string, token: vscode.CancellationToken) => Promise<void>,
  ): Promise<void> {
    const root = this.ctx.activeRepoRoot();
    if (!root || !this.ctx.graphReady()) {
      void vscode.window.showWarningMessage(l10n.t('No Git repository is open.'));
      return;
    }
    const operation = await this.ctx.repoOperationService.getStatus(root);
    if (operation.active) {
      void vscode.window.showWarningMessage(
        operation.summary || l10n.t('Finish or abort the in-progress Git operation first.'),
      );
      return;
    }
    const snapshot = await this.ctx.refsService.loadSnapshot(root);
    const preflight = await checkMergePreflight(this.ctx.cliRegistry.getOrCreate(root), ref);
    await this.ctx.operationForm.show(rebaseForm(sourceBranch ?? snapshot.headRef ?? 'HEAD', ref, preflight.wouldConflict), {
      validate: () => ({}),
      submit: async (values) => {
        await this.ctx.sync.runSyncOp(l10n.t('Rebase'), async (repoRoot, token) => {
          await beforeRebase?.(repoRoot, token);
          await runRebaseOnto(this.ctx.integrationService, repoRoot, ref, token, {
            updateRefs: values.updateDependentBranches === true,
            stashDirty: values.stashAndReapply === true,
          });
        });
        return true;
      },
    });
  }

  async runRebasePrompt(): Promise<void> {
    const ref = await promptIntegrateRef('rebase');
    if (!ref) {
      return;
    }
    await this.runRebaseRef(ref);
  }

  async runInteractiveRebase(onto: string): Promise<void> {
    const root = this.ctx.activeRepoRoot();
    if (!root) {
      void vscode.window.showWarningMessage(l10n.t('No Git repository is open.'));
      return;
    }
    this.ctx.createOrReveal();
    await this.ctx.interactiveRebase.open(root, onto.trim());
  }

  async runBranchDrop(source: string, target: string): Promise<void> {
    if (!source || !target || source === target) {
      return;
    }
    const action = await promptBranchDropAction(source, target);
    if (!action) {
      return;
    }
    log.info(`${action} ${source} -> ${target}`);
    if (action === 'merge') {
      await this.ctx.sync.runSyncOp(l10n.t('Merge'), async (root, token) => {
        await this.ctx.graph.checkoutLocalBranchIfNeeded(root, target, token);
        await runMergeIntoHead(this.ctx.integrationService, this.ctx.cliRegistry, root, source, token);
      });
      return;
    }
    await this.runRebaseRef(target, source, (root, token) =>
      this.ctx.graph.checkoutLocalBranchIfNeeded(root, source, token),
    );
  }

  async runReset(sha: string): Promise<void> {
    const root = this.ctx.activeRepoRoot();
    if (!root || !this.ctx.graphReady()) {
      void vscode.window.showWarningMessage(l10n.t('No Git repository is open.'));
      return;
    }
    const snapshot = await this.ctx.refsService.loadSnapshot(root);
    await this.ctx.operationForm.show(resetForm(snapshot.headRef ?? 'HEAD', sha), {
      validate: () => ({}),
      submit: async (values) => {
        const mode = values.mode as ResetMode;
        await this.ctx.sync.runSyncOp(l10n.t('Reset'), (repoRoot, token) =>
          this.ctx.historyService.reset(repoRoot, mode, sha, { cancellationToken: token }),
        );
        return true;
      },
    });
  }

  async runResetPrompt(): Promise<void> {
    const sha = await promptResetTarget();
    if (!sha) {
      return;
    }
    await this.runReset(sha);
  }

  runCherryPick(sha: string): Promise<void> {
    return this.ctx.sync.runSyncOp(l10n.t('Cherry-pick'), async (root, token) => {
      await runCherryPick(this.ctx.historyService, root, sha, token);
      await this.ctx.submoduleService.updateIfPresent(root);
    });
  }

  async runCherryPickPrompt(): Promise<void> {
    const sha = await promptHistorySha(l10n.t('Cherry-pick'));
    if (!sha) {
      return;
    }
    await this.runCherryPick(sha);
  }

  runRevert(sha: string): Promise<void> {
    return this.ctx.sync.runSyncOp(l10n.t('Revert'), async (root, token) => {
      await runRevert(this.ctx.historyService, root, sha, token);
      await this.ctx.submoduleService.updateIfPresent(root);
    });
  }

  async runRevertPrompt(): Promise<void> {
    const sha = await promptHistorySha(l10n.t('Revert'));
    if (!sha) {
      return;
    }
    await this.runRevert(sha);
  }

  runHistoryRange(op: 'squash' | 'drop' | 'cherryPick', shas: string[]): Promise<void> {
    return this.ctx.sync.runSyncOp(l10n.t('History'), async (root, token) => {
      await runRangeOp(this.ctx.historyService, root, op, shas, token);
      if (op === 'cherryPick') {
        await this.ctx.submoduleService.updateIfPresent(root);
      }
    });
  }

  async runCheckoutPrompt(): Promise<void> {
    const ref = await promptCheckoutRef();
    if (!ref) {
      return;
    }
    await this.runCheckout(ref);
  }

  async runCompareCopyPatch(): Promise<void> {
    const range = this.ctx.activeBranchCompare;
    if (!range) {
      return;
    }
    await this.handleRefsPatchExport(range.base, range.compare, 'copy', 'format-patch');
  }

  async runCompareSavePatch(): Promise<void> {
    const range = this.ctx.activeBranchCompare;
    if (!range) {
      return;
    }
    await this.handleRefsPatchExport(range.base, range.compare, 'save', 'format-patch');
  }

  async runApplyPatchFromClipboard(): Promise<void> {
    const root = this.ctx.activeRepoRoot();
    if (!root || !this.ctx.graphReady()) {
      void vscode.window.showWarningMessage(l10n.t('No Git repository is open.'));
      return;
    }
    await applyPatchFromClipboard(this.ctx.commitPatchService, root);
    await this.refreshAfterPatch();
  }

  async runApplyPatch(): Promise<void> {
    const root = this.ctx.activeRepoRoot();
    if (!root || !this.ctx.graphReady()) {
      void vscode.window.showWarningMessage(l10n.t('No Git repository is open.'));
      return;
    }
    await applyPatchInForm(this.ctx.operationForm.show, this.ctx.commitPatchService, root, () => this.refreshAfterPatch());
  }

  async runCreatePatch(options?: { revision?: string; format?: CommitPatchFormat; saveTo?: string }): Promise<void> {
    const root = this.ctx.activeRepoRoot();
    if (!root || !this.ctx.graphReady()) {
      void vscode.window.showWarningMessage(l10n.t('No Git repository is open.'));
      return;
    }
    await createPatchInForm(this.ctx.operationForm.show, this.ctx.commitPatchService, root, options);
  }

  private async refreshAfterPatch(): Promise<void> {
    await this.ctx.changes.sendWorkingCopySnapshot();
    void this.ctx.reloadGraphOnHeadChange();
    await this.ctx.postState('state');
  }

  /** Saves the files of a commit, branch or tag as a zip or tarball. */
  async runArchive(ref: string): Promise<void> {
    const root = this.ctx.activeRepoRoot();
    if (!root) {
      return;
    }
    const target = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(path.join(path.dirname(root), defaultArchiveName(root, ref.length === 40 ? ref.slice(0, 7) : ref))),
      filters: { [l10n.t('Zip archive')]: ['zip'], [l10n.t('Tarball')]: ['tar.gz', 'tgz'], [l10n.t('Tar archive')]: ['tar'] },
    });
    if (!target) {
      return;
    }
    try {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: l10n.t('Creating {0}…', path.basename(target.fsPath)) },
        () => this.ctx.cliRegistry.getOrCreate(root).execWrite(archiveArgs(ref, target.fsPath, path.basename(root))),
      );
      void vscode.window.showInformationMessage(l10n.t('Saved archive to {0}', target.fsPath));
    } catch (error) {
      log.error('archive failed', error);
      void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async handleHistoryPatchExport(
    shas: string[],
    op: PatchExportOp,
    format: CommitPatchFormat,
  ): Promise<void> {
    const root = this.ctx.activeRepoRoot();
    if (!root || shas.length === 0) {
      return;
    }
    if (op === 'copy') {
      await copyCommitPatch(() => this.ctx.commitPatchService.exportCommits(root, shas, format));
      return;
    }
    // Saving goes through the Create Patch form, which takes the commits as the range they span.
    const ordered = await this.ctx.historyService.orderOldestFirst(root, shas);
    await this.runCreatePatch({
      revision: ordered.length === 1 ? ordered[0] : buildRangeFromOrderedShas(ordered),
      format,
    });
  }

  async handleRefsPatchExport(
    base: string,
    compare: string,
    op: PatchExportOp,
    format: CommitPatchFormat,
  ): Promise<void> {
    const root = this.ctx.activeRepoRoot();
    if (!root) {
      return;
    }
    if (op === 'copy') {
      await copyCommitPatch(() => this.ctx.commitPatchService.exportBranchCompare(root, base, compare, format));
      return;
    }
    await this.runCreatePatch({ revision: buildBranchCommitRange(base, compare), format });
  }
}
