import { coalesced } from '../../core/coalesced';
import * as l10n from '@vscode/l10n';
import * as path from 'path';
import * as vscode from 'vscode';
import { GitCliError } from '../../core/gitCliError';
import { openFileInMergeEditor } from '../conflicts/mergeEditorOpener';
import { toAbsoluteRepoPath } from './workingCopyModel';
import { openWorkingCopyInDiffEditor } from './workingCopyDiffEditor';
import { mapWorkingCopyFailure } from './workingCopyErrors';
import { createLogger } from '../../log';
import { DEFAULT_WORKING_COPY_DIFF_VIEW_OPTIONS } from '../../shared/diff/diffViewOptions';
import type { CommitDiffLineDto } from '../../shared/history/commitDetailsProtocol';
import { commitTreePathContext } from '../../shared/history/pathHistoryProtocol';
import { generateCommitMessage } from './commitMessageGenerator';
import { EMPTY_WORKING_COPY, type WorkingCopyAction, type WorkingCopyDiffSide, type WorkingCopyFileDiffDto, type WorkingCopyEntryDto, type WorkingCopyPatchAction } from '../../shared/changes/workingCopyProtocol';
import { commitStaged } from './commitHost';
import { filterChangeEntries, joinCommitMessage, type ChangesViewOptions } from '../../shared/changes/changesProtocol';
import { commandChangeTargets } from '../../shared/changes/changesTree';
import type { GitCheckoutPanelManager } from '../../panel/gitCheckoutPanelManager';

const log = createLogger('changes');
export const CHANGES_VIEW_STATE_KEY = 'gitCheckout.changesView';

/** What ChangesController needs from the window that owns it. */
export type ChangesContext = Pick<
  GitCheckoutPanelManager,
  | '_onDidChangeRefs'
  | 'activeRepoRoot'
  | 'changesSlot'
  | 'changesView'
  | 'cliRegistry'
  | 'commitDetailsService'
  | 'commitDiffView'
  | 'commitService'
  | 'context'
  | 'gitSettings'
  | 'graphReady'
  | 'merge'
  | 'patchStagingService'
  | 'postMessage'
  | 'postState'
  | 'reloadGraphOnHeadChange'
  | 'setContext'
  | 'stagedList'
  | 'stashSelection'
  | 'sync'
  | 'unstagedList'
  | 'workingTreeService'
>;

export class ChangesController {
  /** The last list failure that was shown, so a refresh that keeps failing does not stack notifications. */
  private lastListFailure: string | undefined;

  /** The changes the Changes tab lists, as last read, for the Stage All and Unstage All buttons. */
  private changeEntries: WorkingCopyEntryDto[] = [];
  /** The change the Changes tab is showing, so view options and refreshes can re-read it. */
  changesSelected: { path: string; side: WorkingCopyDiffSide } | undefined;

  constructor(private readonly ctx: ChangesContext) {}

  /** Changes the Changes tab's view (tree, list, ignored and untracked files) and keeps the choice. */
  updateChangesView(change: Partial<ChangesViewOptions>): void {
    this.ctx.changesView = { ...this.ctx.changesView, ...change };
    void this.ctx.context.globalState.update(CHANGES_VIEW_STATE_KEY, this.ctx.changesView);
    this.publishChangesViewContext();
    this.ctx.changesSlot.post({ type: 'changesView', options: this.ctx.changesView });
    void this.updateChangesTitles();
    if ('showIgnored' in change) {
      void this.sendWorkingCopySnapshot();
    }
  }

  /** The Unstaged and Staged views name their change counts. */
  async updateChangesTitles(): Promise<void> {
    const entries = filterChangeEntries(this.changeEntries, this.ctx.changesView);
    const staged = entries.filter((entry) => entry.group === 'staged');
    const unstaged = entries.filter((entry) => entry.group !== 'staged');
    this.ctx.unstagedList.show({ entries: unstaged, tree: this.ctx.changesView.mode === 'tree' });
    this.ctx.stagedList.show({ entries: staged, tree: this.ctx.changesView.mode === 'tree' });
    const unstagedView = this.ctx.unstagedList.view;
    if (unstagedView) {
      unstagedView.description = unstaged.length > 0 ? String(unstaged.length) : undefined;
      // The Changes tab in the panel bar counts every change, like the Problems tab counts problems.
      unstagedView.badge = entries.length > 0
        ? { value: entries.length, tooltip: l10n.t('{0} changes', entries.length) }
        : undefined;
    }
    const stagedView = this.ctx.stagedList.view;
    if (stagedView) {
      stagedView.description = staged.length > 0 ? String(staged.length) : undefined;
    }
    for (const [key, value] of [
      ['gitCheckout.changes.hasStageable', unstaged.some((entry) => entry.status !== 'ignored')],
      ['gitCheckout.changes.hasStaged', staged.length > 0],
    ] as const) {
      await this.ctx.setContext(key, value);
    }
  }

  /** The changes right now, read from git itself so the buttons never act on a stale list. */
  private async currentChanges(): Promise<WorkingCopyEntryDto[]> {
    const root = this.ctx.activeRepoRoot();
    if (!root || !this.ctx.graphReady()) {
      return [];
    }
    return filterChangeEntries(await this.ctx.workingTreeService.listChanges(root), this.ctx.changesView);
  }

  /** Stages everything listed as unstaged (not ignored files). */
  async stageAllChanges(): Promise<void> {
    const actions = (await this.currentChanges())
      .filter((entry) => entry.group !== 'staged')
      .map((entry) => ({ op: 'stage' as const, path: entry.path }));
    await this.runLocalChangeActions(actions);
  }

  async unstageAllChanges(): Promise<void> {
    const actions = (await this.currentChanges())
      .filter((entry) => entry.group === 'staged')
      .map((entry) => ({ op: 'unstage' as const, path: entry.path }));
    await this.runLocalChangeActions(actions);
  }

  toggleChangesHideUntracked(): void {
    this.updateChangesView({ hideUntracked: !this.ctx.changesView.hideUntracked });
  }

  toggleChangesShowIgnored(): void {
    this.updateChangesView({ showIgnored: !this.ctx.changesView.showIgnored });
  }

  publishChangesViewContext(): void {
    const view = this.ctx.changesView;
    for (const [key, value] of [
      ['gitCheckout.changesView.tree', view.mode === 'tree'],
      ['gitCheckout.changesView.list', view.mode === 'list'],
      ['gitCheckout.changesView.hideUntracked', view.hideUntracked],
      ['gitCheckout.changesView.showIgnored', view.showIgnored],
    ] as const) {
      void this.ctx.setContext(key, value);
    }
  }

  /**
   * A Changes list command on the clicked row, or on every selected row: a menu hands over the row it
   * was opened on, then the whole selection when that row is part of it.
   */
  async runChangesFileCommand(
    command: 'stage' | 'unstage' | 'discard' | 'open' | 'reveal' | 'copyPath' | 'history' | 'blame' | 'externalDiff',
    arg: unknown,
    selected?: unknown,
  ): Promise<void> {
    // A keybinding names the list that has focus, since it hands over no row.
    const keyboardList = (arg as { list?: unknown } | undefined)?.list;
    const list =
      keyboardList === 'unstaged' || keyboardList === 'staged'
        ? keyboardList
        : command === 'stage' || command === 'discard'
          ? 'unstaged'
          : command === 'unstage'
            ? 'staged'
            : undefined;
    const keyboardRows = list === 'unstaged' ? this.ctx.unstagedList.view?.selection : list === 'staged' ? this.ctx.stagedList.view?.selection : undefined;
    const targets = commandChangeTargets(keyboardList ? undefined : arg, selected, keyboardRows);
    const target = targets[0];
    const root = this.ctx.activeRepoRoot();
    if (!target || !root) {
      return;
    }
    const working = (relative: string): vscode.Uri => vscode.Uri.file(path.join(root, relative));
    switch (command) {
      case 'stage':
      case 'unstage':
      case 'discard': {
        // A selection can hold changes of either list; each command only applies to its own side.
        const side = command === 'unstage' ? 'staged' : 'unstaged';
        const actions = targets.filter((entry) => entry.side === side).map((entry) => ({ op: command, path: entry.path }));
        if (actions.length > 0) {
          await this.runLocalChangeActions(actions);
        }
        return;
      }
      case 'open':
        for (const entry of targets) {
          await vscode.window.showTextDocument(working(entry.path), { preview: targets.length === 1 });
        }
        return;
      case 'reveal':
        await vscode.commands.executeCommand('revealFileInOS', working(target.path));
        return;
      case 'copyPath':
        await vscode.env.clipboard.writeText(targets.map((entry) => entry.path).join('\n'));
        return;
      case 'history':
        await vscode.commands.executeCommand('gitCheckout.pathHistory.file', commitTreePathContext(target.path, 'blob'));
        return;
      case 'blame':
        await vscode.commands.executeCommand('gitCheckout.blame.file', commitTreePathContext(target.path, 'blob'));
        return;
      case 'externalDiff':
        await vscode.commands.executeCommand(
          'gitCheckout.openExternalDiff',
          working(target.path),
          targets.map((entry) => working(entry.path)),
        );
        return;
    }
  }

  /** Resolves the conflicted files of the clicked row, or of every selected row, by keeping one side whole. */
  async resolveConflictsWith(side: 'incoming' | 'current', arg: unknown, selected?: unknown): Promise<void> {
    for (const target of commandChangeTargets(arg, selected, undefined)) {
      await this.ctx.merge.takeSide(target.path, side);
    }
  }

  /** Opens a conflicted file in VS Code's merge editor, one of the two ways to fix it. */
  async openConflictInMergeEditor(path: string): Promise<void> {
    const root = this.ctx.activeRepoRoot();
    if (!root) {
      return;
    }
    // Ask Git rather than the last list read: the list may not have caught up with the merge yet.
    const unmerged = await this.ctx.cliRegistry.getOrCreate(root).execRead(['ls-files', '-u', '--', path]);
    if (unmerged.stdout.trim().length === 0) {
      return;
    }
    const opened = await openFileInMergeEditor(vscode.Uri.file(toAbsoluteRepoPath(root, path)), (command, ...args) =>
      vscode.commands.executeCommand(command, ...args),
    );
    if (!opened) {
      log.warn(`the merge editor did not open ${path}`);
    }
  }

  /** Reads the selected change's diff for the Changes tab; a conflicted file gets who conflicts instead. */
  async sendChangesDiff(path: string, side: WorkingCopyDiffSide): Promise<void> {
    const root = this.ctx.activeRepoRoot();
    if (!root || !this.ctx.graphReady()) {
      return;
    }
    this.changesSelected = { path, side };
    const post = (extra: { binary: boolean; lines: CommitDiffLineDto[]; error?: string; nonText?: WorkingCopyFileDiffDto }) =>
      this.ctx.changesSlot.post({ type: 'changesDiff', path, side, ...extra });
    try {
      if (path.endsWith('/')) {
        post({ binary: false, lines: [], error: l10n.t('This folder is ignored by Git.') });
        return;
      }
      const entries = await this.ctx.workingTreeService.listChanges(root);
      if (entries.some((entry) => entry.path === path && entry.status === 'conflict')) {
        // A conflicted file has no diff to read: the Changes tab offers to resolve it.
        const file = await this.ctx.merge.describe(root, path);
        const none = { label: '', subject: '', author: '', date: 0 };
        this.ctx.changesSlot.post({
          type: 'changesConflict', path, side,
          incoming: file?.incoming ?? none, current: file?.current ?? none, canMerge: file?.canMerge ?? false,
          incomingExists: file?.incomingExists ?? true, currentExists: file?.currentExists ?? true,
        });
        return;
      }
      // An ignored file is not in git's change list, but shows like an untracked one: all added.
      const untracked =
        !entries.some((entry) => entry.path === path) ||
        entries.some((entry) => entry.path === path && entry.group === 'untracked');
      const diff = await this.ctx.commitDetailsService.diffWorkingFile(root, path, side, untracked, this.ctx.commitDiffView);
      const nonText =
        diff.binary && !untracked ? await this.ctx.patchStagingService.loadFileDiff(root, path, side) : undefined;
      post({ ...diff, ...(nonText ? { nonText } : {}) });
    } catch (error) {
      log.error('changes diff failed', error);
      post({ binary: false, lines: [], error: error instanceof Error ? error.message : String(error) });
    }
  }

  /** Writes a commit message for the staged changes into the Changes tab's form. */
  async generateChangesMessage(): Promise<void> {
    const root = this.ctx.activeRepoRoot();
    if (!root || !this.ctx.graphReady()) {
      return;
    }
    this.ctx.changesSlot.post({ type: 'changesGenerating', busy: true });
    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: l10n.t('Writing a commit message…'),
          cancellable: true,
        },
        async (_progress, token) => {
          const diff = (
            await this.ctx.cliRegistry.getOrCreate(root).execRead(['diff', '--cached', '--no-color', '-U2', '--patch-with-stat'])
          ).stdout;
          if (!diff.trim()) {
            void vscode.window.showInformationMessage(l10n.t('Stage changes first, then write a commit message.'));
            return;
          }
          const subjects = await this.ctx.commitService.loadRecentSubjects(root, 10);
          const message = await generateCommitMessage(diff, subjects, token);
          if (message) {
            this.ctx.changesSlot.post({ type: 'changesGeneratedMessage', ...message });
          }
        },
      );
    } finally {
      this.ctx.changesSlot.post({ type: 'changesGenerating', busy: false });
    }
  }

  /** Stages, unstages or discards one hunk of the diff the Changes tab is showing. */
  async runChangesHunk(op: 'stage' | 'unstage' | 'discard', patch: string): Promise<void> {
    const root = this.ctx.activeRepoRoot();
    if (!root || !this.ctx.graphReady()) {
      return;
    }
    if (op === 'discard') {
      const confirm = await vscode.window.showWarningMessage(
        l10n.t('Discard this change?'),
        { modal: true, detail: l10n.t('The change is removed from the file in your working tree.') },
        l10n.t('Discard'),
      );
      if (confirm !== l10n.t('Discard')) {
        return;
      }
    }
    try {
      await this.ctx.patchStagingService.applyHunkPatch(root, op, patch);
    } catch (error) {
      log.error(`${op} hunk failed`, error);
      void vscode.window.showErrorMessage(mapWorkingCopyFailure(error));
    }
    this.ctx._onDidChangeRefs.fire();
    await this.sendWorkingCopySnapshot();
    await this.ctx.postState('state');
  }

  /** Commits from the Changes tab's form. */
  async runChangesCommit(subject: string, description: string, amend: boolean, push = false, pushForm = false): Promise<void> {
    let committed = false;
    await this.ctx.sync.runSyncOp(l10n.t('Commit'), async (root) => {
      if (!amend && !(await this.ctx.workingTreeService.hasStagedChanges(root))) {
        void vscode.window.showWarningMessage(l10n.t('Nothing staged to commit.'));
        return;
      }
      if (await commitStaged(this.ctx.context, root, this.ctx.commitService, joinCommitMessage(subject, description), amend)) {
        committed = true;
        this.ctx.changesSlot.post({ type: 'changesCommitted' });
        await this.sendWorkingCopySnapshot();
      }
    });
    // The Push form lets the person choose, including a force push, so it opens after an amend too.
    if (committed && pushForm) {
      await this.ctx.sync.runPush();
      return;
    }
    // An amended commit is not pushed on its own: that would need a force push, which the person should ask for.
    if (committed && (push || (!amend && this.ctx.gitSettings.commitPushAfterCommit()))) {
      await this.ctx.sync.runQuick('push');
    }
  }

  async runLocalChangeActions(
    actions: readonly { op: 'stage' | 'unstage' | 'discard'; path: string }[],
  ): Promise<void> {
    const root = this.ctx.activeRepoRoot();
    if (!root || !this.ctx.graphReady()) {
      void vscode.window.showWarningMessage(l10n.t('No Git repository is open.'));
      return;
    }
    if (actions.length === 0) {
      return;
    }
    if (actions.some((action) => action.op === 'discard')) {
      const label =
        actions.length === 1
          ? (actions[0]?.path ?? l10n.t('this file'))
          : l10n.t('{0} files', actions.length);
      const confirm = await vscode.window.showWarningMessage(
        l10n.t('Discard changes to {0}?', label),
        { modal: true },
        l10n.t('Discard'),
      );
      if (confirm !== l10n.t('Discard')) {
        return;
      }
    }
    try {
      await this.ctx.workingTreeService.runActions(root, actions);
    } catch (error) {
      this.ctx._onDidChangeRefs.fire();
      const message = mapWorkingCopyFailure(error);
      log.error('working copy update failed', error);
      void vscode.window.showErrorMessage(message);
      return;
    }
    this.ctx._onDidChangeRefs.fire();
    await this.sendWorkingCopySnapshot();
    await this.ctx.postState('state');
  }

  async runLocalPatch(action: WorkingCopyPatchAction): Promise<void> {
    const root = this.ctx.activeRepoRoot();
    if (!root || !this.ctx.graphReady()) {
      void vscode.window.showWarningMessage(l10n.t('No Git repository is open.'));
      return;
    }
    if (action.op === 'stashHunk' || action.op === 'stashLine') {
      await this.ctx.stashSelection(action);
      return;
    }
    if (action.op === 'discardHunk' || action.op === 'discardLine') {
      const confirm = await vscode.window.showWarningMessage(
        l10n.t('Discard selected changes in {0}?', action.path),
        { modal: true },
        l10n.t('Discard'),
      );
      if (confirm !== l10n.t('Discard')) {
        return;
      }
    }
    try {
      await this.ctx.patchStagingService.runPatchAction(root, action);
    } catch (error) {
      const message = mapWorkingCopyFailure(error);
      log.error('working copy patch failed', error);
      void vscode.window.showErrorMessage(message);
      return;
    }
    this.ctx._onDidChangeRefs.fire();
    const side = action.op.startsWith('unstage') ? 'staged' : 'unstaged';
    await this.sendWorkingCopyFileDiff(action.path, side);
    await this.sendWorkingCopySnapshot();
    await this.ctx.postState('state');
  }

  /**
   * Reads the working copy and sends it to the lists. A change reaches this from several directions at once
   * (the command that made it, the file watcher, a diagnostics event), so overlapping requests share runs.
   */
  readonly sendWorkingCopySnapshot = coalesced(() => this.readWorkingCopySnapshot());

  private async readWorkingCopySnapshot(): Promise<void> {
    const root = this.ctx.activeRepoRoot();
    if (!root || !this.ctx.graphReady()) {
      this.changeEntries = [];
      void this.updateChangesTitles();
      this.ctx.postMessage({ type: 'workingCopySnapshot', snapshot: EMPTY_WORKING_COPY });
      return;
    }
    try {
      const [loaded, ignored] = await Promise.all([
        this.ctx.workingTreeService.loadSnapshot(root),
        this.ctx.changesView.showIgnored ? this.ctx.workingTreeService.listIgnored(root) : [],
      ]);
      const snapshot = ignored.length > 0 ? { ...loaded, entries: [...loaded.entries, ...ignored] } : loaded;
      this.changeEntries = snapshot.entries;
      this.lastListFailure = undefined;
      void this.updateChangesTitles();
      this.ctx.postMessage({ type: 'workingCopySnapshot', snapshot });
    } catch (error) {
      const message =
        error instanceof GitCliError ? `${error.code}: ${error.message}` : String(error);
      log.error(`working copy list failed: ${message}`, error);
      this.notifyListFailure(message);
    }
  }

  /** Shows a failure to list changes once, however many refreshes fail the same way before one succeeds. */
  private notifyListFailure(message: string): void {
    if (message === this.lastListFailure) {
      return;
    }
    this.lastListFailure = message;
    void vscode.window.showErrorMessage(message);
  }

  async sendWorkingCopyBinaryChunk(
    blobRef: string,
    offset: number,
    maxBytes?: number,
  ): Promise<void> {
    try {
      const chunk = await this.ctx.patchStagingService.loadBinaryChunk(blobRef, offset, maxBytes);
      if (!chunk) {
        return;
      }
      this.ctx.postMessage({ type: 'workingCopyBinaryChunk', blobRef, chunk });
    } catch (error) {
      const message =
        error instanceof GitCliError ? `${error.code}: ${error.message}` : String(error);
      log.error(`binary chunk failed: ${message}`, error);
    }
  }

  async sendWorkingCopyFileDiff(
    path: string,
    side: WorkingCopyDiffSide,
    options = DEFAULT_WORKING_COPY_DIFF_VIEW_OPTIONS,
  ): Promise<void> {
    const root = this.ctx.activeRepoRoot();
    if (!root || !this.ctx.graphReady()) {
      return;
    }
    try {
      const diff = await this.ctx.patchStagingService.loadFileDiff(root, path, side, options);
      this.ctx.postMessage({ type: 'workingCopyFileDiff', diff });
    } catch (error) {
      const message =
        error instanceof GitCliError ? `${error.code}: ${error.message}` : String(error);
      log.error(`working copy diff failed: ${message}`, error);
      void vscode.window.showErrorMessage(message);
    }
  }

  async openWorkingCopyInDiffEditor(path: string, side: WorkingCopyDiffSide): Promise<void> {
    const root = this.ctx.activeRepoRoot();
    if (!root || !this.ctx.graphReady()) {
      void vscode.window.showWarningMessage(l10n.t('No Git repository is open.'));
      return;
    }
    try {
      await openWorkingCopyInDiffEditor(root, path, side);
    } catch (error) {
      const message =
        error instanceof GitCliError ? `${error.code}: ${error.message}` : String(error);
      log.error(`open diff editor failed: ${message}`, error);
      void vscode.window.showErrorMessage(message);
    }
  }

  async handleWorkingCopyAction(action: WorkingCopyAction): Promise<void> {
    if (action.op === 'stage' || action.op === 'unstage' || action.op === 'discard') {
      await this.runLocalChangeActions([action]);
      return;
    }
    const root = this.ctx.activeRepoRoot();
    if (!root || !this.ctx.graphReady()) {
      void vscode.window.showWarningMessage(l10n.t('No Git repository is open.'));
      return;
    }
    try {
      await this.ctx.workingTreeService.runAction(root, action);
    } catch (error) {
      const message = mapWorkingCopyFailure(error);
      log.error('working copy update failed', error);
      void vscode.window.showErrorMessage(message);
      return;
    }
    await this.sendWorkingCopySnapshot();
    await this.ctx.postState('state');
    void this.ctx.reloadGraphOnHeadChange();
  }
}
