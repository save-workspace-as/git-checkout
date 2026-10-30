import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { GitCliError } from '../../core/gitCliError';
import type { GitExtensionService } from '../../core/gitExtensionService';
import { PathHistoryService } from './pathHistoryService';
import { buildGitCheckoutBlobUri } from '../../core/gitCheckoutUri';
import { createLogger } from '../../log';
import type { CommitDiffLineDto } from '../../shared/history/commitDetailsProtocol';
import type { WorkingCopyFileDiffDto } from '../../shared/changes/workingCopyProtocol';
import {
  defaultPathHistoryFollow,
  isCommitTreePathContext,
  isHunkHistoryContext,
  locateRepoFile,
  parentRepoPath,
  parseHunkLineRange,
  pathHistorySummary,
  pathHistoryTitle,
  resetFileConfirmMessage,
  type PathHistoryHostMessage,
  type PathHistoryScope,
  type PathHistoryViewOption,
  type PathHistoryWebviewMessage,
} from '../../shared/history/pathHistoryProtocol';
import { githubRepositoryFor } from './githubLinkHost';
import type { BlameService } from './blameService';
import { annotateDiffLines } from '../../shared/history/blameAnnotation';

const log = createLogger('path-history');

const FILE_SCOPE_KEY = 'gitCheckout.pathHistory.fileScope';
const CAN_RESET_KEY = 'gitCheckout.pathHistory.canReset';

interface PathHistorySession {
  repoRoot: string;
  scope: PathHistoryScope;
  path: string;
  startLine?: number;
  endLine?: number;
  follow: boolean;
  includeMerges: boolean;
  skip: number;
  selectedSha: string | null;
  hasMore: boolean;
  /** Shown in the Blame modal rather than the History modal. */
  blame?: boolean;
  /** The commits the modal has listed, newest first. */
  loaded: string[];
  /** A commit to bring into the list, loading pages until it is there. */
  wanted?: string;
}

/** How many pages of commits are loaded to find one: more than this and the commit is far back, or not in the file's history. */
const MAX_WANTED_PAGES = 30;

function filePathFromArg(arg: unknown): string | undefined {
  if (!arg || typeof arg !== 'object' || !('fsPath' in arg) || !('scheme' in arg)) {
    return undefined;
  }
  const uri = arg as { fsPath?: unknown; scheme?: unknown };
  if (uri.scheme !== 'file' || typeof uri.fsPath !== 'string' || !uri.fsPath) {
    return undefined;
  }
  return uri.fsPath;
}

function errorText(error: unknown): string {
  if (error instanceof GitCliError && error.stderr.trim()) {
    return error.stderr.trim();
  }
  return error instanceof Error ? error.message : String(error);
}

/** How the History modal in the main panel is shown and fed. */
export interface PathHistoryTransport {
  /** Brings the main panel forward, where the modal lives. */
  show(): void;
  /** The repository of the window this history belongs to. */
  repoRoot(): string | null;
  post(message: PathHistoryHostMessage): void;
  loadDiff(
    repoRoot: string,
    sha: string,
    path: string,
  ): Promise<{ binary: boolean; lines: CommitDiffLineDto[]; nonText?: WorkingCopyFileDiffDto }>;
  /** Opens the file as it was at `revision` in an editor. */
  openAtRevision(revision: string, path: string): Promise<void>;
  applyViewOption(option: PathHistoryViewOption): void;
}

/** File, folder and hunk history, shown in a modal over the main panel. */
export class PathHistoryPanel implements vscode.Disposable {
  private transport: PathHistoryTransport | undefined;
  private epoch = 0;
  private diffEpoch = 0;
  private session: PathHistorySession | undefined;

  constructor(
    private readonly gitService: GitExtensionService,
    private readonly service: PathHistoryService,
    private readonly blameService: BlameService,
  ) {}

  attach(transport: PathHistoryTransport): void {
    this.transport = transport;
  }

  dispose(): void {
    this.session = undefined;
    void this.setContexts(undefined);
  }

  async showFile(arg?: unknown): Promise<void> {
    if (isCommitTreePathContext(arg)) {
      if (arg.commitTreeKind !== 'blob') {
        return;
      }
      const repoRoot = this.activeRepoRoot();
      if (!repoRoot) {
        this.warnNoRepo();
        return;
      }
      await this.open({ scope: 'file', repoRoot, path: arg.path });
      return;
    }
    const located = this.locate(filePathFromArg(arg) ?? this.activeFile());
    if (!located || located.path === '.') {
      this.warnNoRepo();
      return;
    }
    await this.open({ scope: 'file', repoRoot: located.repoRoot, path: located.path });
  }

  /** The Blame modal: the file's commits one at a time, each line of the selected commit's change with the commit that last touched it. */
  async showBlame(arg?: unknown): Promise<void> {
    const located = isCommitTreePathContext(arg) && arg.commitTreeKind === 'blob'
      ? (this.activeRepoRoot() ? { repoRoot: this.activeRepoRoot() as string, path: arg.path } : undefined)
      : this.locate(filePathFromArg(arg) ?? this.activeFile());
    if (!located || located.path === '.') {
      this.warnNoRepo();
      return;
    }
    await this.open({ scope: 'file', repoRoot: located.repoRoot, path: located.path, blame: true });
  }

  /** The Blame modal for a file, with the commit that last changed a line already selected. */
  async showBlameAt(repoRoot: string, path: string, sha: string): Promise<void> {
    await this.open({ scope: 'file', repoRoot, path, blame: true, select: sha });
  }

  /**
   * The Blame modal at the commit that last changed a line before `sha` did. `commitPath` and `line` say where the line
   * was in `sha`; the modal itself follows the file under `path`.
   */
  async showBlameBefore(repoRoot: string, path: string, sha: string, commitPath: string, line: number): Promise<void> {
    const before = await this.blameService.previousChange(repoRoot, sha, commitPath, line);
    if (!before) {
      void vscode.window.showInformationMessage(l10n.t('This line has no earlier version.'));
      return;
    }
    await this.showBlameAt(repoRoot, path, before.sha);
  }

  async showDirectory(arg?: unknown): Promise<void> {
    if (isCommitTreePathContext(arg)) {
      if (arg.commitTreeKind !== 'tree') {
        return;
      }
      const repoRoot = this.activeRepoRoot();
      if (!repoRoot) {
        this.warnNoRepo();
        return;
      }
      await this.open({ scope: 'directory', repoRoot, path: arg.path });
      return;
    }
    const fsPath = filePathFromArg(arg);
    const located = this.locate(fsPath ?? this.activeFile());
    if (!located) {
      this.warnNoRepo();
      return;
    }
    const path = fsPath ? located.path : parentRepoPath(located.path);
    await this.open({ scope: 'directory', repoRoot: located.repoRoot, path });
  }

  async showHunk(arg?: unknown): Promise<void> {
    if (isHunkHistoryContext(arg)) {
      const repoRoot = this.activeRepoRoot();
      if (!repoRoot) {
        this.warnNoRepo();
        return;
      }
      await this.open({
        scope: 'hunk',
        repoRoot,
        path: arg.path,
        startLine: arg.startLine,
        endLine: arg.endLine,
      });
      return;
    }
    let repoRoot: string | undefined;
    let path: string | undefined;
    if (isCommitTreePathContext(arg) && arg.commitTreeKind === 'blob') {
      repoRoot = this.activeRepoRoot();
      path = arg.path;
    } else {
      const located = this.locate(filePathFromArg(arg) ?? this.activeFile());
      repoRoot = located?.repoRoot;
      path = located && located.path !== '.' ? located.path : undefined;
    }
    if (!repoRoot || !path) {
      this.warnNoRepo();
      return;
    }
    const range = this.selectionInFile(repoRoot, path) ?? (await this.askRange(path));
    if (!range) {
      return;
    }
    await this.open({
      scope: 'hunk',
      repoRoot,
      path,
      startLine: range.start,
      endLine: range.end,
    });
  }

  private async toggleFollow(): Promise<void> {
    const session = this.session;
    if (!session || session.scope !== 'file') {
      return;
    }
    session.follow = !session.follow;
    session.selectedSha = null;
    this.syncContext();
    await this.reload(false);
  }

  private async toggleMerges(): Promise<void> {
    const session = this.session;
    if (!session) {
      return;
    }
    session.includeMerges = !session.includeMerges;
    session.selectedSha = null;
    this.syncContext();
    await this.reload(false);
  }

  private async resetSelectedFile(): Promise<void> {
    const session = this.session;
    if (!session || session.scope !== 'file' || !session.selectedSha) {
      return;
    }
    const sha = session.selectedSha;
    const rel = session.path;
    try {
      const historical = vscode.Uri.parse(buildGitCheckoutBlobUri(session.repoRoot, sha, rel));
      const working = vscode.Uri.joinPath(vscode.Uri.file(session.repoRoot), ...rel.split('/'));
      await vscode.commands.executeCommand(
        'vscode.diff',
        historical,
        working,
        l10n.t('{0} ({1} ↔ working tree)', rel, sha.slice(0, 7)),
      );
    } catch (error) {
      log.warn('reset preview diff failed', error);
    }
    let stat = '';
    try {
      stat = await this.service.diffStat(session.repoRoot, sha, rel);
    } catch (error) {
      log.warn('reset preview stat failed', error);
    }
    const choice = await vscode.window.showWarningMessage(
      resetFileConfirmMessage(rel, sha),
      { modal: true, detail: stat || undefined },
      l10n.t('Reset File'),
    );
    if (choice !== l10n.t('Reset File')) {
      return;
    }
    try {
      await this.service.resetFile(session.repoRoot, sha, rel);
    } catch (error) {
      log.error('reset file failed', error);
    }
  }

  private async open(target: {
    scope: PathHistoryScope;
    repoRoot: string;
    path: string;
    startLine?: number;
    endLine?: number;
    blame?: boolean;
    /** A commit to show first instead of the newest. */
    select?: string;
  }): Promise<void> {
    const { select, ...rest } = target;
    this.session = {
      ...rest,
      loaded: [],
      wanted: select,
      follow: defaultPathHistoryFollow(target.scope),
      includeMerges: false,
      skip: 0,
      selectedSha: null,
      hasMore: false,
    };
    this.transport?.show();
    this.transport?.post({
      type: 'pathHistoryOpen',
      scope: target.scope,
      path: target.path,
      title: pathHistoryTitle(target.scope, target.path),
      canFollow: target.scope === 'file',
      mode: target.blame ? 'blame' : 'history',
      ...(select ? { select } : {}),
    });
    this.syncContext();
    log.info(`${target.scope} history ${target.path}`);
    await this.reload(false);
  }

  /** Handles what the History modal sends. */
  async handleMessage(message: PathHistoryWebviewMessage): Promise<void> {
    const session = this.session;
    if (!session) {
      return;
    }
    switch (message.type) {
      case 'pathHistoryLoadMore':
        if (session.hasMore) {
          await this.reload(true);
        }
        return;
      case 'pathHistorySelect':
        session.selectedSha = message.sha;
        this.syncContext();
        await this.sendDiff(session, message.sha);
        return;
      case 'pathHistoryBlameBefore':
        await this.stepBack(session, message.sha, message.line);
        return;
      case 'pathHistoryOpenInEditor':
        await this.transport?.openAtRevision(message.sha, session.path);
        return;
      case 'pathHistoryToggle':
        await (message.option === 'follow' ? this.toggleFollow() : this.toggleMerges());
        return;
      case 'pathHistoryReset':
        await this.resetSelectedFile();
        return;
      case 'pathHistoryViewOption':
        this.transport?.applyViewOption(message.option);
        return;
      case 'pathHistoryClose':
        this.session = undefined;
        void this.setContexts(undefined);
        return;
    }
  }

  /** Re-reads the selected commit's diff, after a view option changed how git should produce it. */
  async refreshDiff(): Promise<void> {
    const session = this.session;
    if (session?.selectedSha) {
      await this.sendDiff(session, session.selectedSha);
    }
  }

  private async sendDiff(session: PathHistorySession, sha: string): Promise<void> {
    const transport = this.transport;
    if (!transport) {
      return;
    }
    const epoch = ++this.diffEpoch;
    try {
      const diff = await transport.loadDiff(session.repoRoot, sha, session.path);
      if (epoch === this.diffEpoch && this.session === session) {
        transport.post({ type: 'pathHistoryDiff', sha, ...diff });
        if (session.blame && !diff.binary && !diff.nonText) {
          await this.sendBlame(session, sha, diff.lines, epoch);
        }
      }
    } catch (error) {
      if (epoch === this.diffEpoch && this.session === session) {
        log.error('history diff failed', error);
        transport.post({ type: 'pathHistoryDiff', sha, binary: false, lines: [], error: errorText(error) });
      }
    }
  }

  private async sendBlame(session: PathHistorySession, sha: string, lines: CommitDiffLineDto[], epoch: number): Promise<void> {
    // Blame only the lines the diff shows: the file as the commit left it for added and unchanged lines,
    // as it was before for removed ones. Blaming the whole file twice per commit took seconds on large files.
    const numbers = (kinds: readonly string[]) => lines.flatMap((line) => (kinds.includes(line.kind) && line.line ? [line.line] : []));
    const load = async (revision: string, wanted: number[]) => {
      try {
        return await this.blameService.loadLineNumbers(session.repoRoot, revision, session.path, wanted);
      } catch (error) {
        // A root commit has no parent, and a renamed file has another name there: those lines show no blame.
        log.debug(`no blame for ${session.path} at ${revision}`, error);
        return [];
      }
    };
    const [after, before] = await Promise.all([load(sha, numbers(['add', 'context'])), load(`${sha}^`, numbers(['del']))]);
    if (epoch === this.diffEpoch && this.session === session) {
      this.post({ type: 'pathHistoryBlame', sha, ...annotateDiffLines(lines, after, before) });
    }
  }

  private async reload(append: boolean): Promise<void> {
    const session = this.session;
    if (!session) {
      return;
    }
    const epoch = ++this.epoch;
    if (!append) {
      session.skip = 0;
      session.selectedSha = null;
      this.syncContext();
    }
    try {
      const page = await this.service.loadPage(session.repoRoot, {
        scope: session.scope,
        path: session.path,
        startLine: session.startLine,
        endLine: session.endLine,
        follow: session.follow,
        includeMerges: session.includeMerges,
        skip: session.skip,
      });
      if (epoch !== this.epoch || this.session !== session) {
        return;
      }
      session.skip += page.advance;
      session.hasMore = page.hasMore;
      session.loaded = append ? session.loaded.concat(page.commits.map((commit) => commit.sha)) : page.commits.map((commit) => commit.sha);
      this.post({
        type: 'pathHistoryMeta',
        summary: pathHistorySummary(session),
        github: await githubRepositoryFor(session.repoRoot),
        follow: session.follow,
        includeMerges: session.includeMerges,
      });
      this.post({ type: 'pathHistoryPage', page, append });
      const wanted = session.wanted;
      if (wanted && !(await this.loadUntilWanted(session, epoch)) && session.hasMore && session.loaded[0]) {
        // Too far back to find: the modal is waiting for a commit, so give it the newest.
        this.post({ type: 'pathHistorySelectCommit', sha: session.loaded[0] });
      }
    } catch (error) {
      if (epoch !== this.epoch) {
        return;
      }
      log.error('path history failed', error);
      void vscode.window.showErrorMessage(errorText(error));
      this.post({ type: 'pathHistoryFailed' });
    }
  }

  /** Keeps loading pages while the commit asked for is not in the list and there are more. */
  private async loadUntilWanted(session: PathHistorySession, epoch: number): Promise<boolean> {
    for (let pages = 0; session.wanted && !session.loaded.includes(session.wanted) && session.hasMore && pages < MAX_WANTED_PAGES; pages++) {
      if (epoch !== this.epoch || this.session !== session) {
        return false;
      }
      await this.reloadMore(session);
    }
    const found = !!session.wanted && session.loaded.includes(session.wanted);
    session.wanted = undefined;
    return found;
  }

  private async reloadMore(session: PathHistorySession): Promise<void> {
    const page = await this.service.loadPage(session.repoRoot, {
      scope: session.scope,
      path: session.path,
      startLine: session.startLine,
      endLine: session.endLine,
      follow: session.follow,
      includeMerges: session.includeMerges,
      skip: session.skip,
    });
    session.skip += page.advance;
    session.hasMore = page.hasMore;
    session.loaded = session.loaded.concat(page.commits.map((commit) => commit.sha));
    this.post({ type: 'pathHistoryPage', page, append: true });
  }

  /** The Blame modal's line button: show the commit that changed the line before the selected commit did. */
  private async stepBack(session: PathHistorySession, sha: string, line: number): Promise<void> {
    const before = await this.blameService.previousChange(session.repoRoot, sha, session.path, line);
    if (!before) {
      void vscode.window.showInformationMessage(l10n.t('This line has no earlier version.'));
      return;
    }
    session.wanted = before.sha;
    if (await this.loadUntilWanted(session, this.epoch) && this.session === session) {
      this.post({ type: 'pathHistorySelectCommit', sha: before.sha });
    } else {
      void vscode.window.showInformationMessage(l10n.t('The earlier version of this line is not in the history of this file.'));
    }
  }

  private post(message: PathHistoryHostMessage): void {
    this.transport?.post(message);
  }

  private syncContext(): void {
    void this.setContexts(this.session);
  }

  private setContexts(session: PathHistorySession | undefined): Thenable<unknown> {
    const fileScope = session?.scope === 'file';
    return Promise.all([
      vscode.commands.executeCommand('setContext', FILE_SCOPE_KEY, fileScope),
      vscode.commands.executeCommand('setContext', CAN_RESET_KEY, fileScope && !!session?.selectedSha),
    ]);
  }

  private locate(fsPath: string | undefined): { repoRoot: string; path: string } | undefined {
    if (!fsPath) {
      return undefined;
    }
    return locateRepoFile(
      this.gitService.getRepositories().map((repo) => repo.rootUri.fsPath),
      fsPath,
    );
  }

  private activeRepoRoot(): string | undefined {
    return this.transport?.repoRoot() ?? this.gitService.getDiagnostics().repositories[0]?.rootPath;
  }

  private activeFile(): string | undefined {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.scheme !== 'file') {
      return undefined;
    }
    return editor.document.uri.fsPath;
  }

  private selectionInFile(
    repoRoot: string,
    path: string,
  ): { start: number; end: number } | undefined {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.selection.isEmpty || editor.document.uri.scheme !== 'file') {
      return undefined;
    }
    const located = locateRepoFile([repoRoot], editor.document.uri.fsPath);
    if (!located || located.path !== path) {
      return undefined;
    }
    const start = editor.selection.start.line + 1;
    let end = editor.selection.end.line + 1;
    if (
      editor.selection.end.character === 0 &&
      editor.selection.end.line > editor.selection.start.line
    ) {
      end = editor.selection.end.line;
    }
    return { start, end: Math.max(start, end) };
  }

  private async askRange(path: string): Promise<{ start: number; end: number } | undefined> {
    const raw = await vscode.window.showInputBox({
      title: l10n.t('Hunk History'),
      prompt: l10n.t('Line range in {0}', path),
      placeHolder: l10n.t('12,40'),
      validateInput: (value) =>
        parseHunkLineRange(value) ? undefined : l10n.t('Enter a range like 12,40'),
    });
    if (!raw) {
      return undefined;
    }
    return parseHunkLineRange(raw) ?? undefined;
  }

  private warnNoRepo(): void {
    void vscode.window.showWarningMessage(l10n.t('Open a file in a Git repository to see its history.'));
  }
}
