import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import * as path from 'node:path';
import { type GitFlowRunResult } from '../gitflow/gitFlowService';
import { checkMergePreflight } from '../branches/mergePreflight';
import type { ResetMode } from './historyService';
import { createLogger } from '../../log';
import type { CommitPatchFormat, PatchExportOp } from '../../shared/patches/patchProtocol';
import { promptCheckoutRef } from '../branches/checkoutHost';
import { resolveCompare, type CompareMode } from './compareTargets';
import { ACTION_ICONS } from '../../shared/app/actionIcons';
import type { LocalChangesMode } from '../branches/checkoutService';
import { runCommitFlow } from '../changes/commitHost';
import { executeGitFlow } from '../gitflow/gitFlowHost';
import { executeSigningToggle } from '../signing/signingHost';
import { promptHistorySha, runCherryPick, runRangeOp, runRevert } from '../graph/graphHistoryHost';
import { promptBranchDropAction, promptIntegrateRef, runMergeIntoHead, runRebaseOnto } from '../branches/integrateHost';
import { promptResetTarget } from '../branches/resetHost';
import { archiveArgs, defaultArchiveName } from './archive';
import { rememberSavedFolder, saveDialogStart } from '../../panel/saveLocation';
import { applyPatchFromClipboard, applyPatchInForm, copyCommitPatch, createPatchInForm } from './patchHost';
import { buildBranchCommitRange, buildRangeFromOrderedShas } from './commitRangePatch';
import { CHECKOUT_LOCAL_CHANGES, MERGE_TYPE_FAST_FORWARD, checkoutForm, editCommitMessageForm, fixupForm, mergeForm, rebaseForm, resetForm, splitCommitForm, squashIntoParentForm, undoOperationForm } from '../../panel/operationForms';
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
  | 'showCommitRange'
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

  /** Checks out `ref`. With a fast-forward to offer or changes in the working tree there is something to decide, so a form asks first. */
  async runCheckout(ref: string, localBranch = false): Promise<void> {
    const run = (options: { fastForward?: boolean; localChanges?: LocalChangesMode }): Promise<void> =>
      this.ctx.sync.runSyncOp(l10n.t('Checking out'), async (root, token) => {
        await this.ctx.checkoutService.checkout(root, ref, { cancellationToken: token, localBranch, ...options });
        if (this.ctx.gitSettings.checkoutUpdateSubmodules()) {
          // Submodules follow the commits the checked-out branch records, as `git checkout --recurse-submodules` would.
          await this.ctx.submoduleService.updateIfPresent(root);
        }
      });
    const root = this.ctx.activeRepoRoot();
    if (!root || !this.ctx.graphReady()) {
      await run({});
      return;
    }
    const offer = localBranch ? null : await this.ctx.checkoutService.detectFastForward(root, ref);
    const dirty = (await this.ctx.workingTreeService.getStatus(root)).dirty;
    if (!offer && !dirty) {
      await run({});
      return;
    }
    const preferred: LocalChangesMode = this.ctx.gitSettings.leanBranchingStashOnSwitch() ? 'stash' : 'keep';
    await this.ctx.operationForm.show(checkoutForm(ref, offer, dirty, preferred), {
      validate: () => ({}),
      submit: async (values) => {
        const chosen = CHECKOUT_LOCAL_CHANGES.find((mode) => mode === values.localChanges);
        await run({ fastForward: offer !== null && values.fastForward === true, ...(dirty && chosen ? { localChanges: chosen } : {}) });
        return true;
      },
    });
  }

  /** Shows what changed between a commit and another one: HEAD, where the two diverged, the upstream of its branch, or a ref picked from a list. */
  async runCompare(sha: string, mode: CompareMode, branch?: string): Promise<void> {
    const root = this.ctx.activeRepoRoot();
    if (!root || !this.ctx.graphReady()) {
      void vscode.window.showWarningMessage(l10n.t('No Git repository is open.'));
      return;
    }
    let target = mode === 'upstream' ? branch : undefined;
    if (mode === 'ref') {
      target = await this.pickCompareRef(root);
      if (!target) {
        return;
      }
    }
    const resolved = await resolveCompare(this.ctx.cliRegistry.getOrCreate(root), mode, sha, target);
    if (!resolved.ok) {
      void vscode.window.showWarningMessage(resolved.message);
      return;
    }
    await this.ctx.showCommitRange(resolved.base, resolved.head);
  }

  private async pickCompareRef(root: string): Promise<string | undefined> {
    const snapshot = await this.ctx.refsService.loadSnapshot(root);
    const items = [
      ...snapshot.branches.map((ref) => ({ label: `$(${ACTION_ICONS.branch}) ${ref.name}`, description: l10n.t('local'), name: ref.name })),
      ...snapshot.remoteBranches.map((ref) => ({ label: `$(${ACTION_ICONS.remoteBranch}) ${ref.name}`, description: l10n.t('remote'), name: ref.name })),
      ...snapshot.tags.map((ref) => ({ label: `$(${ACTION_ICONS.tag}) ${ref.name}`, description: l10n.t('tag'), name: ref.name })),
    ];
    return (await vscode.window.showQuickPick(items, { placeHolder: l10n.t('Select a branch or tag to compare with') }))?.name;
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

  /** Edit Commit Message: a form with the commit's message, and the commit replaced by one with the new message. */
  async runEditMessage(sha: string): Promise<void> {
    const root = this.ctx.activeRepoRoot();
    if (!root || !this.ctx.graphReady()) {
      void vscode.window.showWarningMessage(l10n.t('No Git repository is open.'));
      return;
    }
    const info = await this.ctx.historyService.commitMessageInfo(root, sha);
    if (info.problem) {
      void vscode.window.showWarningMessage(info.problem);
      return;
    }
    await this.ctx.operationForm.show(editCommitMessageForm(sha, info.subject, info.message, info.pushedTo), {
      validate: (values) => {
        const errors: Record<string, string> = {};
        if (!String(values.message ?? '').trim()) {
          errors.message = l10n.t('Enter a commit message.');
        }
        return errors;
      },
      submit: async (values) => {
        const message = String(values.message ?? '');
        if (message.trim() === info.message.trim()) {
          return true;
        }
        await this.ctx.sync.runSyncOp(l10n.t('Edit Commit Message'), (repoRoot, token) =>
          this.ctx.historyService.rewordCommit(repoRoot, sha, message, { cancellationToken: token }),
        );
        return true;
      },
    });
  }

  /** Folds the staged changes into a commit of the checked-out branch. */
  async runFixup(sha: string): Promise<void> {
    const root = this.ctx.activeRepoRoot();
    if (!root || !this.ctx.graphReady()) {
      void vscode.window.showWarningMessage(l10n.t('No Git repository is open.'));
      return;
    }
    const problem = await this.ctx.historyService.rewriteProblem(root, sha);
    if (problem) {
      void vscode.window.showWarningMessage(problem);
      return;
    }
    if (!(await this.ctx.workingTreeService.hasStagedChanges(root))) {
      void vscode.window.showWarningMessage(l10n.t('Stage the changes to fold into the commit first.'));
      return;
    }
    const info = await this.ctx.historyService.commitMessageInfo(root, sha);
    await this.ctx.operationForm.show(fixupForm(sha, info.subject, info.pushedTo), {
      validate: () => ({}),
      submit: async () => {
        await this.ctx.sync.runSyncOp(l10n.t('Fixup'), (repoRoot, token) =>
          this.ctx.historyService.fixupCommit(repoRoot, sha, { cancellationToken: token }),
        );
        return true;
      },
    });
  }

  /** Takes a commit of the checked-out branch apart: its changes come back unstaged, in the middle of a rebase that stops there. */
  async runSplit(sha: string): Promise<void> {
    const root = this.ctx.activeRepoRoot();
    if (!root || !this.ctx.graphReady()) {
      void vscode.window.showWarningMessage(l10n.t('No Git repository is open.'));
      return;
    }
    const problem = await this.ctx.historyService.rewriteProblem(root, sha);
    if (problem) {
      void vscode.window.showWarningMessage(problem);
      return;
    }
    const [parent] = await this.ctx.historyService.getParents(root, sha);
    if (!parent) {
      void vscode.window.showWarningMessage(l10n.t('The first commit of the history cannot be split.'));
      return;
    }
    if ((await this.ctx.workingTreeService.getStatus(root)).dirty) {
      void vscode.window.showWarningMessage(l10n.t('Commit or stash your changes before splitting a commit.'));
      return;
    }
    const info = await this.ctx.historyService.commitMessageInfo(root, sha);
    await this.ctx.operationForm.show(splitCommitForm(sha, info.subject, info.pushedTo), {
      validate: () => ({}),
      submit: async () => {
        await this.ctx.sync.runSyncOp(l10n.t('Split Commit'), (repoRoot, token) =>
          this.ctx.historyService.startSplit(repoRoot, sha, { cancellationToken: token }),
        );
        void vscode.window.showInformationMessage(l10n.t('Stage part of the changes and commit them, repeat for the rest, then continue the rebase.'));
        return true;
      },
    });
  }

  /** Melts a commit of the checked-out branch into its parent. */
  async runSquashIntoParent(sha: string): Promise<void> {
    const root = this.ctx.activeRepoRoot();
    if (!root || !this.ctx.graphReady()) {
      void vscode.window.showWarningMessage(l10n.t('No Git repository is open.'));
      return;
    }
    const problem = await this.ctx.historyService.rewriteProblem(root, sha);
    if (problem) {
      void vscode.window.showWarningMessage(problem);
      return;
    }
    const [parent] = await this.ctx.historyService.getParents(root, sha);
    if (!parent) {
      void vscode.window.showWarningMessage(l10n.t('The first commit of the history has no parent to squash into.'));
      return;
    }
    const [info, parentInfo] = await Promise.all([
      this.ctx.historyService.commitMessageInfo(root, sha),
      this.ctx.historyService.commitMessageInfo(root, parent),
    ]);
    await this.ctx.operationForm.show(squashIntoParentForm(sha, info.subject, parent, parentInfo.subject, parentInfo.message, parentInfo.pushedTo), {
      validate: (values) => {
        const errors: Record<string, string> = {};
        if (!String(values.message ?? '').trim()) {
          errors.message = l10n.t('Enter a commit message.');
        }
        return errors;
      },
      submit: async (values) => {
        await this.ctx.sync.runSyncOp(l10n.t('Squash into Parent'), (repoRoot, token) =>
          this.ctx.historyService.squashIntoParent(repoRoot, sha, String(values.message ?? ''), { cancellationToken: token }),
        );
        return true;
      },
    });
  }

  /** Moves the branch back to where it was before its last reset, rebase, amend, merge or commit. */
  async runUndo(): Promise<void> {
    const root = this.ctx.activeRepoRoot();
    if (!root || !this.ctx.graphReady()) {
      void vscode.window.showWarningMessage(l10n.t('No Git repository is open.'));
      return;
    }
    const last = await this.ctx.historyService.lastOperation(root);
    if (!last) {
      void vscode.window.showInformationMessage(l10n.t('There is nothing to undo on the current branch.'));
      return;
    }
    await this.ctx.operationForm.show(undoOperationForm(last.branch, last, last.previousSummary), {
      validate: () => ({}),
      submit: async (values) => {
        const mode: ResetMode = values.mode === 'hard' ? 'hard' : 'keep';
        await this.ctx.sync.runSyncOp(l10n.t('Undo'), (repoRoot, token) =>
          this.ctx.historyService.reset(repoRoot, mode, last.previousSha, { cancellationToken: token }),
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
      defaultUri: saveDialogStart(defaultArchiveName(root, ref.length === 40 ? ref.slice(0, 7) : ref), path.dirname(root)),
      filters: { [l10n.t('Zip archive')]: ['zip'], [l10n.t('Tarball')]: ['tar.gz', 'tgz'], [l10n.t('Tar archive')]: ['tar'] },
    });
    if (!target) {
      return;
    }
    rememberSavedFolder(target);
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
