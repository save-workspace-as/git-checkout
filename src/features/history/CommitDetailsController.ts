import * as l10n from '@vscode/l10n';
import * as path from 'path';
import * as vscode from 'vscode';
import { commitFileDiffEndpoints } from '../../shared/history/commitDetails';
import { GitCliError } from '../../core/gitCliError';
import { buildGitCheckoutBlobUri } from '../../core/gitCheckoutUri';
import { EMPTY_COMMIT_PERSON } from './commitDetailsService';
import { openCommitFileDiff } from '../changes/workingCopyDiffEditor';
import { createLogger } from '../../log';
import type { CommitFileListMode } from '../../shared/history/commitFileList';
import type { CommitFileChangeDto } from '../../shared/history/commitDetailsProtocol';
import type { DiffViewOption } from '../../shared/history/pathHistoryProtocol';
import { CommitFileActions, type CommitFileAction } from './commitFileActions';
import { stepContextLines, type CommitDiffViewOptions } from '../../shared/diff/commitDiffPresentation';
import type { HostMessage } from '../../shared/protocol';
import type { CommitTreePageDto } from '../../shared/history/commitTreeProtocol';
import { EMPTY_COMMIT_FILES, EMPTY_TREE } from './revisionLists';
import { revisionPaths } from '../../shared/history/revisionTree';
import type { GitCheckoutPanelManager } from '../../panel/gitCheckoutPanelManager';

const log = createLogger('history');
export const DIFF_VIEW_STATE_KEY = 'gitCheckout.commitDiffView';

/** What CommitDetailsController needs from the window that owns it. */
export type CommitDetailsContext = Pick<
  GitCheckoutPanelManager,
  | 'activeRepoRoot'
  | 'changes'
  | 'cliRegistry'
  | 'commitDetailsService'
  | 'commitDiffView'
  | 'commitFilesList'
  | 'commitSlot'
  | 'commitTreeService'
  | 'context'
  | 'graphReady'
  | 'pathHistory'
  | 'postMessage'
  | 'setContext'
  | 'treeList'
>;

export class CommitDetailsController {
  /** The revision the File Tree lists, with its paths, so a window that becomes current can show them. */
  private treePage: CommitTreePageDto | undefined;
  private treeError: string | undefined;
  /** Bumped per file preview, so a slow older read cannot replace a newer one. */
  private treePreviewEpoch = 0;
  lastCommitSha: string | undefined;
  /** Older commit of a two-commit comparison; unset while a single commit is shown. */
  lastCommitBase: string | undefined;
  /** The file whose diff the Changes tab is showing, so view options can re-read it. */
  private shownDiffFile: { sha: string; baseSha?: string; path: string; oldPath?: string } | undefined;
  lastCommitPreview:
    | Extract<HostMessage, { type: 'commitDetailsPreview' | 'commitComparePreview' }>
    | undefined;
  private commitTreeEpoch = 0;
  private commitDetailsEpoch = 0;
  private commitFileListMode: CommitFileListMode = 'flat';
  private readonly commitFileActions = new CommitFileActions({
    repoRoot: () => this.ctx.activeRepoRoot(),
    cli: (root) => this.ctx.cliRegistry.getOrCreate(root),
    openChange: (target) =>
      this.openSelectedCommitFile(target.revision, target.path, target.status ?? 'M', target.oldPath, target.baseRevision),
    openAtRevision: (revision, path) => this.openCommitTreeFileInEditor(revision, path),
    refreshWorkingCopy: () => this.ctx.changes.sendWorkingCopySnapshot(),
  });
  /** The files the Changes tab is listing, for opening and re-reading them. */
  private shownFiles: { sha: string; baseSha?: string; files: CommitFileChangeDto[] } | undefined;

  constructor(private readonly ctx: CommitDetailsContext) {}

  navigateCommitDiff(direction: 'previous' | 'next'): void {
    this.ctx.commitSlot.post({ type: 'commitDiffNavigate', direction });
  }

  /** Applies a view change: git-side options re-read the shown file's diff, the rest repaint it. */
  private updateCommitDiffView(change: Partial<CommitDiffViewOptions>, regenerate: boolean): void {
    this.ctx.commitDiffView = { ...this.ctx.commitDiffView, ...change };
    if (!this.ctx.commitDiffView.sideBySide) {
      this.ctx.commitDiffView.swapped = false;
    }
    this.publishCommitDiffContext();
    this.postCommitDiffView();
    void this.ctx.context.globalState.update(DIFF_VIEW_STATE_KEY, this.ctx.commitDiffView);
    const shown = this.shownDiffFile;
    if (regenerate && shown) {
      void this.sendCommitFileDiff(shown.sha, shown.path, shown.baseSha, shown.oldPath);
    }
    if (regenerate) {
      void this.ctx.pathHistory?.refreshDiff();
      const selected = this.ctx.changes.changesSelected;
      if (selected) {
        void this.ctx.changes.sendChangesDiff(selected.path, selected.side);
      }
    }
  }

  toggleCommitDiffIgnoreWhitespace(): void {
    this.updateCommitDiffView({ ignoreWhitespace: !this.ctx.commitDiffView.ignoreWhitespace }, true);
  }

  toggleCommitDiffInvisibles(): void {
    this.updateCommitDiffView({ showInvisibles: !this.ctx.commitDiffView.showInvisibles }, false);
  }

  changeCommitDiffContext(direction: 1 | -1): void {
    this.updateCommitDiffView(
      { contextLines: stepContextLines(this.ctx.commitDiffView.contextLines, direction), fullFile: false },
      true,
    );
  }

  toggleCommitDiffWrap(): void {
    this.updateCommitDiffView({ wrapLines: !this.ctx.commitDiffView.wrapLines }, false);
  }

  toggleCommitDiffFullFile(): void {
    this.updateCommitDiffView({ fullFile: !this.ctx.commitDiffView.fullFile }, true);
  }

  toggleCommitDiffSideBySide(): void {
    this.updateCommitDiffView({ sideBySide: !this.ctx.commitDiffView.sideBySide }, false);
  }

  swapCommitDiffSides(): void {
    if (this.ctx.commitDiffView.sideBySide) {
      this.updateCommitDiffView({ swapped: !this.ctx.commitDiffView.swapped }, false);
    }
  }

  publishCommitDiffContext(): void {
    const view = this.ctx.commitDiffView;
    for (const [key, value] of [
      ['gitCheckout.diffIgnoreWhitespace', view.ignoreWhitespace],
      ['gitCheckout.diffInvisibles', view.showInvisibles],
      ['gitCheckout.diffWrap', view.wrapLines],
      ['gitCheckout.diffFullFile', view.fullFile],
      ['gitCheckout.diffSideBySide', view.sideBySide],
    ] as const) {
      void this.ctx.setContext(key, value);
    }
  }

  postCommitDiffView(): void {
    const settings = vscode.workspace.getConfiguration('gitCheckout');
    this.ctx.postMessage({
      type: 'commitDiffView',
      options: {
        ...this.ctx.commitDiffView,
        syntaxHighlighting: settings.get<boolean>('diff.syntaxHighlighting', true),
        changeMarks: settings.get<boolean>('diff.changeMarks', true),
      },
    });
  }

  setCommitFileListMode(mode: CommitFileListMode): void {
    this.commitFileListMode = mode;
    this.publishCommitFileListContext();
    this.pushRevisionLists();
  }

  /** Runs a diff toolbar button by name, as the History modal's toolbar does. */
  applyDiffViewOption(option: DiffViewOption): void {
    switch (option) {
      case 'previousChange':
        return this.navigateCommitDiff('previous');
      case 'nextChange':
        return this.navigateCommitDiff('next');
      case 'swapSides':
        return this.swapCommitDiffSides();
      case 'ignoreWhitespace':
        return this.toggleCommitDiffIgnoreWhitespace();
      case 'invisibles':
        return this.toggleCommitDiffInvisibles();
      case 'wrap':
        return this.toggleCommitDiffWrap();
      case 'moreContext':
        return this.changeCommitDiffContext(1);
      case 'lessContext':
        return this.changeCommitDiffContext(-1);
      case 'fullFile':
        return this.toggleCommitDiffFullFile();
      case 'sideBySide':
        return this.toggleCommitDiffSideBySide();
    }
  }

  runCommitFileAction(action: CommitFileAction, arg: unknown, selected?: unknown): Promise<void> {
    // Copying a path covers every selected file; the other actions are about the one clicked.
    if (action === 'copyPath' && Array.isArray(selected) && selected.length > 1) {
      return Promise.resolve(vscode.env.clipboard.writeText(revisionPaths(selected).join('\n')));
    }
    return this.commitFileActions.run(action, arg);
  }

  /** Shows the commit's changed files and the revision's tree in their native lists. */
  pushRevisionLists(): void {
    const shown = this.shownFiles;
    const asTree = this.commitFileListMode === 'tree';
    this.ctx.commitFilesList.show(
      shown?.files ?? [],
      { revision: shown?.sha ?? '', ...(shown?.baseSha ? { baseRevision: shown.baseSha } : {}), list: 'changes', tree: asTree },
      shown ? EMPTY_COMMIT_FILES() : undefined,
    );
    if (shown?.files[0]) {
      const current = this.shownDiffFile;
      this.ctx.commitFilesList.selectPath(current?.sha === shown.sha ? current.path : null);
    }
    const filesView = this.ctx.commitFilesList.view;
    if (filesView) {
      filesView.description = shown && shown.files.length > 0 ? String(shown.files.length) : undefined;
    }
    const page = this.treePage;
    this.ctx.treeList.show(
      (page?.paths ?? []).map((path) => ({ path })),
      { revision: page?.revision ?? 'HEAD', list: 'tree', tree: true },
      this.treeError ?? (page ? EMPTY_TREE() : undefined),
    );
    const treeView = this.ctx.treeList.view;
    if (treeView) {
      treeView.description = page?.commit
        ? `${page.commit.sha.slice(0, 7)} · ${page.commit.subject}`
        : page && page.revision !== 'HEAD' ? page.revision : undefined;
    }
  }

  /** The files the Changes tab lists, for tests. */
  commitFilesSnapshot(): { sha: string; baseSha?: string; files: CommitFileChangeDto[] } | undefined {
    return this.shownFiles;
  }

  /** The file list picked a file: show its diff beside the commit summary. */
  async showChangedFile(sha: string, baseSha: string | undefined, path: string): Promise<void> {
    const file = this.shownFiles?.files.find((entry) => entry.path === path);
    if (!file || this.shownFiles?.sha !== sha) {
      return;
    }
    this.ctx.commitSlot.post({
      type: 'commitDetailsShowFile',
      sha,
      ...(baseSha ? { baseSha } : {}),
      path: file.path,
    });
    this.shownDiffFile = { sha, baseSha, path: file.path, oldPath: file.oldPath };
    this.ctx.commitFilesList.selectPath(file.path);
    await this.sendCommitFileDiff(sha, file.path, baseSha, file.oldPath);
  }

  publishCommitFileListContext(): void {
    void this.ctx.setContext('gitCheckout.commitFileTree', this.commitFileListMode === 'tree');
  }

  async sendCommitTreePage(revision: string): Promise<void> {
    const epoch = ++this.commitTreeEpoch;
    this.treePreviewEpoch += 1;
    this.ctx.postMessage({ type: 'commitTreePreviewClear' });
    const root = this.ctx.activeRepoRoot();
    if (!root || !this.ctx.graphReady()) {
      if (epoch !== this.commitTreeEpoch) {
        return;
      }
      this.treePage = { revision: revision.trim() || 'HEAD', paths: [] };
      this.treeError = undefined;
      this.pushRevisionLists();
      return;
    }
    try {
      const page = await this.ctx.commitTreeService.list(root, revision);
      if (epoch !== this.commitTreeEpoch) {
        return;
      }
      this.treePage = page;
      this.treeError = undefined;
      this.pushRevisionLists();
    } catch (error) {
      if (epoch !== this.commitTreeEpoch) {
        return;
      }
      log.error('commit tree failed', error);
      const message =
        error instanceof GitCliError
          ? `${error.code}: ${error.message}`
          : error instanceof Error
            ? error.message
            : String(error);
      this.treeError = message;
      this.treePage = { revision: revision.trim() || 'HEAD', paths: [] };
      this.pushRevisionLists();
    }
  }

  async sendCommitDetails(sha: string, baseSha?: string): Promise<void> {
    const revision = sha.trim();
    this.lastCommitSha = revision || undefined;
    this.lastCommitBase = baseSha;
    const epoch = ++this.commitDetailsEpoch;
    this.shownDiffFile = undefined;
    const root = this.ctx.activeRepoRoot();
    if (!revision || !root || !this.ctx.graphReady()) {
      this.shownFiles = undefined;
      this.pushRevisionLists();
      this.ctx.postMessage({
        type: 'commitDetails',
        details: { sha: revision, files: [], body: '', committer: EMPTY_COMMIT_PERSON },
      });
      return;
    }
    try {
      const [files, body, committer] = baseSha
        ? [
            await this.ctx.commitDetailsService.listFilesBetween(root, baseSha, revision),
            '',
            EMPTY_COMMIT_PERSON,
          ]
        : await Promise.all([
            this.ctx.commitDetailsService.listFiles(root, revision),
            this.ctx.commitDetailsService.readBody(root, revision),
            this.ctx.commitDetailsService.readCommitter(root, revision),
          ]);
      if (epoch !== this.commitDetailsEpoch) {
        return;
      }
      this.shownFiles = { sha: revision, ...(baseSha ? { baseSha } : {}), files };
      this.ctx.postMessage({
        type: 'commitDetails',
        details: { sha: revision, files, body, committer, ...(baseSha ? { baseSha } : {}) },
      });
      this.pushRevisionLists();
      // The first changed file is shown until another is picked.
      if (files[0]) {
        await this.showChangedFile(revision, baseSha, files[0].path);
      }
    } catch (error) {
      if (epoch !== this.commitDetailsEpoch) {
        return;
      }
      log.error('commit details failed', error);
      const message =
        error instanceof GitCliError
          ? `${error.code}: ${error.message}`
          : error instanceof Error
            ? error.message
            : String(error);
      void vscode.window.showErrorMessage(message);
    }
  }

  private async sendCommitFileDiff(
    sha: string,
    filePath: string,
    baseSha?: string,
    oldPath?: string,
  ): Promise<void> {
    const root = this.ctx.activeRepoRoot();
    if (!root) {
      return;
    }
    try {
      const diff = baseSha
        ? await this.ctx.commitDetailsService.diffFileBetween(root, baseSha, sha, filePath, this.ctx.commitDiffView, oldPath)
        : await this.ctx.commitDetailsService.diffFile(root, sha, filePath, this.ctx.commitDiffView, oldPath);
      const nonText = diff.binary
        ? await this.ctx.commitDetailsService
            .binaryPreview(root, baseSha ?? (await this.ctx.commitDetailsService.resolveParent(root, sha)), sha, filePath)
            .catch((error: unknown) => {
              log.warn('binary preview failed', error);
              return undefined;
            })
        : undefined;
      this.ctx.postMessage({
        type: 'commitDetailsFileDiff',
        sha,
        ...(baseSha ? { baseSha } : {}),
        path: filePath,
        binary: diff.binary,
        lines: diff.lines,
        ...(nonText ? { nonText } : {}),
      });
    } catch (error) {
      log.error('commit file diff failed', error);
      this.ctx.postMessage({
        type: 'commitDetailsFileDiff',
        sha,
        ...(baseSha ? { baseSha } : {}),
        path: filePath,
        binary: false,
        lines: [],
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async openSelectedCommitFile(
    sha: string,
    filePath: string,
    status: string,
    oldPath?: string,
    baseSha?: string,
  ): Promise<void> {
    const root = this.ctx.activeRepoRoot();
    if (!root) {
      void vscode.window.showWarningMessage(l10n.t('No Git repository is open.'));
      return;
    }
    try {
      const parent = baseSha ?? (await this.ctx.commitDetailsService.resolveParent(root, sha));
      const endpoints = commitFileDiffEndpoints(sha, parent, {
        status,
        path: filePath,
        ...(oldPath ? { oldPath } : {}),
      });
      const base = parent ? parent.slice(0, 7) : 'empty';
      const title = `${endpoints.rightPath} (${base} ↔ ${sha.slice(0, 7)})`;
      log.info(`open diff ${endpoints.rightPath} at ${sha}`);
      await openCommitFileDiff(root, endpoints, title);
    } catch (error) {
      log.error('open commit diff failed', error);
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(message);
    }
  }

  async openCommitTreeFileInEditor(revision: string, filePath: string): Promise<void> {
    const root = this.ctx.activeRepoRoot();
    if (!root) {
      void vscode.window.showWarningMessage(l10n.t('No Git repository is open.'));
      return;
    }
    try {
      const uri = vscode.Uri.parse(buildGitCheckoutBlobUri(root, revision, filePath));
      // The tab names the revision, so the version being read is never mistaken for the working file.
      const label = l10n.t('{0} @ {1}', path.basename(filePath), revision.length > 12 ? revision.slice(0, 7) : revision);
      await vscode.commands.executeCommand('vscode.open', uri, { preview: true }, label);
    } catch (error) {
      log.error('open file at revision failed', error);
      void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async openCommitTreeFile(revision: string, filePath: string): Promise<void> {
    const root = this.ctx.activeRepoRoot();
    const epoch = ++this.treePreviewEpoch;
    if (!root) {
      this.ctx.postMessage({
        type: 'commitTreeFilePreview',
        preview: { revision, path: filePath, text: '', error: l10n.t('No Git repository is open.') },
      });
      return;
    }
    try {
      const uri = vscode.Uri.parse(buildGitCheckoutBlobUri(root, revision, filePath));
      const document = await vscode.workspace.openTextDocument(uri);
      if (epoch !== this.treePreviewEpoch) {
        return;
      }
      this.ctx.postMessage({
        type: 'commitTreeFilePreview',
        preview: { revision, path: filePath, text: document.getText() },
      });
    } catch (error) {
      if (epoch !== this.treePreviewEpoch) {
        return;
      }
      log.error('preview file at revision failed', error);
      const message = error instanceof Error ? error.message : String(error);
      this.ctx.postMessage({
        type: 'commitTreeFilePreview',
        preview: { revision, path: filePath, text: '', error: message },
      });
    }
  }
}
