import { coalesced } from '../core/coalesced';
import * as l10n from '@vscode/l10n';
import * as path from 'path';
import * as vscode from 'vscode';
import { CheckoutService } from '../features/branches/checkoutService';
import { CommitGraphService } from '../features/graph/commitGraphService';
import { CommitTreeService } from '../features/history/commitTreeService';
import { CommitService } from '../features/changes/commitService';
import { GitFlowService, type GitFlowRunResult } from '../features/gitflow/gitFlowService';
import { formatSigningFailure } from '../features/signing/signingDiagnostics';
import {
    createWorkspaceGitCheckoutSettings,
    type GitCheckoutSettingsReader,
} from '../core/gitCheckoutSettings';
import { GitCliError } from '../core/gitCliError';
import type { GitCliRegistry } from '../core/gitCliRegistry';
import type { GitExtensionService } from '../core/gitExtensionService';
import type { GitWatchService } from '../core/gitWatchService';
import { GitHubAvatars } from '../features/graph/githubAvatars';
import { CommitPatchService } from '../features/history/commitPatchService';
import { HistoryService } from '../features/history/historyService';
import { IntegrationService } from '../features/branches/integrationService';
import { PatchStagingService } from '../features/changes/patchStagingService';
import { RefsService } from '../features/branches/refsService';
import { StashService } from '../features/stash/stashService';
import { resolveActiveRepoRoot } from '../features/submodules/submoduleOpen';
import { sidebarRepositoryRoots } from '../ui/sidebarRepositories';
import { sameWorktreePath } from '../features/worktrees/worktreeParser';
import { SubmoduleService } from '../features/submodules/submoduleService';
import { WorktreeService } from '../features/worktrees/worktreeService';
import { RemoteSyncService } from '../features/sync/remoteSyncService';
import { BisectService } from '../features/bisect/bisectService';
import { planInProgressRecovery } from '../features/operations/inProgressOperationRecovery';
import { RepoOperationService } from '../features/operations/repoOperationService';
import { CommitDetailsService } from '../features/history/commitDetailsService';
import { WorkingTreeService } from '../features/changes/workingTreeService';
import { createLogger } from '../log';
import type { WorktreeStatusDto } from '../shared/changes/dailyGitProtocol';
import { type BisectMark } from '../shared/bisect/bisectProtocol';
import { ALL_COMMITS_FILTER, type GraphCommitContext } from '../shared/graph/graphProtocol';
import { IDLE_REPO_OPERATION } from '../shared/history/historyProtocol';
import type { CommitFileListMode } from '../shared/history/commitFileList';
import type { CommitFileChangeDto } from '../shared/history/commitDetailsProtocol';
import { PathHistoryPanel } from '../features/history/pathHistoryPanel';
import { BlameService } from '../features/history/blameService';
import { openPullRequestPage } from '../features/history/githubLinkHost';
import { PathHistoryService } from '../features/history/pathHistoryService';
import { type CommitFileAction } from '../features/history/commitFileActions';
import {
  parseStoredDiffView,
  type CommitDiffViewOptions } from '../shared/diff/commitDiffPresentation';
import { editorTokenColorsFromRules } from '../shared/diff/editorTokenColors';
import type { HostMessage, WebviewMessage } from '../shared/protocol';
import type { RefsMutateOp, RefsSnapshotDto } from '../shared/branches/refsProtocol';
import { type StashEntryDto } from '../shared/stash/stashProtocol';
import type { GitSubmoduleDto } from '../shared/submodules/submoduleProtocol';
import type { GitWorktreeDto } from '../shared/worktrees/worktreeProtocol';
import {
    type WorkingCopyDiffSide,
    type WorkingCopyPatchAction } from '../shared/changes/workingCopyProtocol';
import { hideBuiltInScm } from '../ui/scmVisibility';
import { copyTextToClipboard } from './clipboardHost';
import {
  parseStoredChangesView,
  splitCommitMessage,
  type ChangesViewOptions } from '../shared/changes/changesProtocol';
import { githubRepositoryFor, openGitHubIssueLink } from '../features/history/githubLinkHost';
import { GRAPH_CONTEXT_COMMANDS } from '../features/graph/graphContextCommands';

import { showGitCheckoutQuickLaunch, type QuickLaunchHost } from './quickLaunch';
import { openTerminalForRepo } from './repoTerminal';
import { RepositoryNotOpenError } from '../core/repositoryNotOpenError';
import { OperationFormController } from './operationFormController';
import { buildUiState } from './uiState';
import { readActiveEditorTokenColors } from './activeEditorTheme';
import { l10nBodyAttribute } from '../shared/app/l10nAttribute';
import { ScopedBottomViewSlot, type BottomSlot } from './bottomPanelViews';
import { webviewImgSrc } from './webviewImgSrc';
import { ScopedChangesList } from '../features/changes/changesList';
import { ScopedRevisionList } from '../features/history/revisionLists';
import type { PanelWindowHost } from './panelWindowHost';
import { bottomViewsFor } from './bottomViewTarget';
import { describeOperation, type OperationBannerModel } from '../shared/history/operationBanner';
import { OperationController } from '../features/operations/OperationController';
import { InteractiveRebaseController } from '../features/rebase/interactiveRebaseController';

/** Most commits reloaded in one go when a refresh keeps the user's scroll position. */

const log = createLogger('panel');

/** Most icons one request may ask for. */


function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let i = 0; i < 32; i++) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}

let githubAvatars: GitHubAvatars | undefined;

/** One cache of GitHub pictures for every window, so an author is looked up once per session. */
function sharedGitHubAvatars(): GitHubAvatars {
  githubAvatars ??= new GitHubAvatars({
    async get(url, token) {
      const response = await fetch(url, {
        headers: { Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      return { status: response.status, body: response.ok ? await response.json() : undefined };
    },
    async token() {
      try {
        return (await vscode.authentication.getSession('github', ['read:user'], { silent: true }))?.accessToken;
      } catch (error) {
        // No GitHub sign-in in VS Code: GitHub is asked without one, at a lower rate limit.
        log.debug('no GitHub session for avatars', error);
        return undefined;
      }
    },
    now: () => Date.now(),
  });
  return githubAvatars;
}

function getWebviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  nonce: string,
  allowGravatar: boolean,
  script = 'main.js',
): string {
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'webview', script));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'webview', 'styles.css'));
  const codiconUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'webview', 'codicon.css'));
  const cspSource = webview.cspSource;
  const imgSrc = webviewImgSrc(cspSource, allowGravatar);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${imgSrc}; font-src ${cspSource}; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}' ${cspSource};" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${styleUri}" />
  <link rel="stylesheet" id="vscode-codicon-stylesheet" href="${codiconUri}" nonce="${nonce}" />
  <title>Git Checkout</title>
</head>
<body${l10nBodyAttribute(vscode.l10n.bundle)}>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

import { SyncController } from '../features/sync/SyncController';

import { ChangesController, CHANGES_VIEW_STATE_KEY } from '../features/changes/ChangesController';
import { MergeResolverController } from '../features/conflicts/MergeResolverController';

import { CommitDetailsController, DIFF_VIEW_STATE_KEY } from '../features/history/CommitDetailsController';

import { GraphController } from '../features/graph/GraphController';

import { BisectController } from '../features/bisect/BisectController';

import { HistoryOperationsController } from '../features/history/HistoryOperationsController';

import { StashController } from '../features/stash/StashController';
import { HousekeepingController } from '../features/housekeeping/HousekeepingController';
import { RepoSettingsController } from '../features/repoSettings/RepoSettingsController';

import { WorktreeController } from '../features/worktrees/WorktreeController';
import { CloneController } from '../features/clone/CloneController';

import { SubmoduleController } from '../features/submodules/SubmoduleController';

import { RefsController } from '../features/branches/RefsController';

const COMMIT_TAB_FOCUS_COMMAND = 'gitCheckout.commit.focus';

export class GitCheckoutPanelManager implements vscode.Disposable {
  panel: vscode.WebviewPanel | undefined;
  readonly commitSlot: BottomSlot;
  readonly treeList: ScopedRevisionList;
  readonly commitFilesList: ScopedRevisionList;
  private readonly treePreviewSlot: BottomSlot;
  /** The view to focus when the bottom panel opens: the Commit tab unless something asked for another. */
  bottomFocusCommand = COMMIT_TAB_FOCUS_COMMAND;
  private webviewReady = false;
  private readonly pendingMessages: HostMessage[] = [];
  readonly _onDidChangeRefs = new vscode.EventEmitter<void>();
  readonly onDidChangeRefs = this._onDidChangeRefs.event;
  private readonly headShortByRepo = new Map<string, string | null>();
  private readonly disposables: vscode.Disposable[] = [];
  readonly graphService: CommitGraphService;
  readonly commitTreeService: CommitTreeService;
  readonly commitDetailsService: CommitDetailsService;
  readonly refsService: RefsService;
  readonly workingTreeService: WorkingTreeService;
  readonly patchStagingService: PatchStagingService;
  readonly commitPatchService: CommitPatchService;
  readonly checkoutService: CheckoutService;
  readonly commitService: CommitService;
  readonly gitFlowService: GitFlowService;
  readonly remoteSyncService: RemoteSyncService;
  readonly integrationService: IntegrationService;
  readonly historyService: HistoryService;
  readonly stashService: StashService;
  readonly worktreeService: WorktreeService;
  readonly submoduleService: SubmoduleService;
  readonly operationForm: OperationFormController;
  /** Submodule opened inside this window. Falls back until vscode.git lists it. */
  selectedRepoRoot: string | null = null;
  readonly repoOperationService: RepoOperationService;
  readonly bisectService: BisectService;
  readonly cliRegistry: GitCliRegistry;
  readonly gitSettings: GitCheckoutSettingsReader;
  activeBranchCompare: { base: string; compare: string } | null = null;
  /** Shown in the sidebar until the index write finishes or fails. */
  commitDiffView: CommitDiffViewOptions;
  readonly pathHistory: PathHistoryPanel;
  readonly interactiveRebase: InteractiveRebaseController;
  readonly operation = new OperationController(this);
  private readonly filesSlot: BottomSlot;
  readonly changesSlot: BottomSlot;
  readonly unstagedList: ScopedChangesList;
  readonly stagedList: ScopedChangesList;
  changesView: ChangesViewOptions;

  /** Fetch, pull and push. */
  readonly sync = new SyncController(this);

  /** The Changes tab: the working-copy lists, the diff and the commit form. */
  readonly changes: ChangesController = new ChangesController(this);

  /** The Merge modal, where a conflicted file is resolved side by side. */
  readonly merge: MergeResolverController = new MergeResolverController(this);

  /** Commit details, the changed-file and File Tree lists, and the diff options. */
  readonly details = new CommitDetailsController(this);

  /** The commit graph: paging, filters, search and reveal. */
  readonly graph = new GraphController(this);

  /** Bisect sessions. */
  readonly bisect = new BisectController(this);

  /** Checkout, merge, rebase, cherry-pick, revert, reset, commit, patches and Git Flow. */
  readonly operations = new HistoryOperationsController(this);

  /** Stashes. */
  readonly stash = new StashController(this);

  /** Pruning, merged branches, cleaning and garbage collection. */
  readonly housekeeping = new HousekeepingController(this);

  /** Git configuration of the repository. */
  readonly repoSettings = new RepoSettingsController(this);

  /** Cloning a repository. */
  readonly clones = new CloneController(this);

  /** Worktrees. */
  readonly worktrees = new WorktreeController(this);

  /** Submodules. */
  readonly submodules = new SubmoduleController(this);

  /** Branches, tags and remotes, and the data the sidebar shows. */
  readonly refs = new RefsController(this);

  constructor(
    readonly context: vscode.ExtensionContext,
    readonly gitService: GitExtensionService,
    watchService: GitWatchService,
    cliRegistry: GitCliRegistry,
    private readonly host: PanelWindowHost,
    /** The repository this window is for; without one it follows the first open repository. */
    pinnedRepoRoot: string | null = null,
  ) {
    this.cliRegistry = cliRegistry;
    // Each window runs its own rebase, conflict and history sessions, so two repositories can at once.
    this.interactiveRebase = new InteractiveRebaseController(gitService, cliRegistry);
    this.interactiveRebase.attachPoster((message) => this.postWhenReady(message));
    this.pathHistory = new PathHistoryPanel(gitService, new PathHistoryService(cliRegistry), new BlameService(cliRegistry));
    this.attachPathHistory(this.pathHistory);
    this.disposables.push(this.interactiveRebase, this.pathHistory);
    this.selectedRepoRoot = pinnedRepoRoot;
    const owns = (): boolean => host.owns(this);
    this.commitSlot = new ScopedBottomViewSlot(host.slots.commit, owns);
    this.filesSlot = new ScopedBottomViewSlot(host.slots.files, owns);
    this.treeList = new ScopedRevisionList(host.lists.tree, owns);
    this.commitFilesList = new ScopedRevisionList(host.lists.commitFiles, owns);
    this.treePreviewSlot = new ScopedBottomViewSlot(host.slots.treePreview, owns);
    this.changesSlot = new ScopedBottomViewSlot(host.slots.changes, owns);
    this.unstagedList = new ScopedChangesList(host.lists.unstaged, owns);
    this.stagedList = new ScopedChangesList(host.lists.staged, owns);
    this.operationForm = new OperationFormController(
      () => this.createOrReveal(),
      (message) => this.postWhenReady(message),
    );
    const gitSettings = createWorkspaceGitCheckoutSettings();
    this.gitSettings = gitSettings;
    this.graphService = new CommitGraphService(context, gitService, cliRegistry, gitSettings);
    this.graphService.githubAvatars = sharedGitHubAvatars();
    void this.graph.syncGraphCollapseMergesContext();
    void this.graph.syncGraphShowReflogContext();
    void this.graph.syncGraphActiveBranchOnlyContext();
    this.commitTreeService = new CommitTreeService(cliRegistry);
    this.commitDetailsService = new CommitDetailsService(cliRegistry);
    this.refsService = new RefsService(gitService, cliRegistry, this.graphService);
    this.workingTreeService = new WorkingTreeService(gitService, cliRegistry);
    this.patchStagingService = new PatchStagingService(gitService, cliRegistry);
    this.checkoutService = new CheckoutService(
      gitService,
      cliRegistry,
      this.workingTreeService,
      gitSettings,
    );
    this.commitService = new CommitService(gitService, cliRegistry, gitSettings);
    this.gitFlowService = new GitFlowService(cliRegistry, gitSettings);
    this.remoteSyncService = new RemoteSyncService(
      gitService,
      cliRegistry,
      this.workingTreeService,
      gitSettings,
    );
    this.integrationService = new IntegrationService(
      gitService,
      cliRegistry,
      this.workingTreeService,
      gitSettings,
    );
    this.historyService = new HistoryService(cliRegistry, gitSettings);
    this.stashService = new StashService(cliRegistry);
    this.worktreeService = new WorktreeService(cliRegistry);
    this.submoduleService = new SubmoduleService(cliRegistry);
    this.commitPatchService = new CommitPatchService(cliRegistry, this.historyService);
    this.repoOperationService = new RepoOperationService(gitService, cliRegistry);
    this.bisectService = new BisectService(cliRegistry);

    this.commitDiffView = parseStoredDiffView(context.globalState.get(DIFF_VIEW_STATE_KEY));
    this.changesView = parseStoredChangesView(context.globalState.get(CHANGES_VIEW_STATE_KEY));
    this.changes.publishChangesViewContext();
    this.details.publishCommitDiffContext();
    this.details.publishCommitFileListContext();
    this.disposables.push(
      this.operationForm,
      this._onDidChangeRefs,
      gitService.onDidChangeDiagnostics(() => {
        if (this.panel) {
          this.panel.title = this.panelTitle();
        }
        void this.syncRepoOperationContext();
        void this.postState('state');
        void this.reloadGraphOnHeadChange();
        void this.changes.sendWorkingCopySnapshot();
      }),
      watchService.onDidRefresh((event) => {
        this.headShortByRepo.set(event.repoRoot, event.headShort);
        // The Changes tab lives outside the main panel, so it needs fresh changes either way.
        void this.changes.sendWorkingCopySnapshot();
        if (this.panel) {
          void this.postState('state');
          void this.reloadGraphOnHeadChange();
        }
      }),
      vscode.window.onDidChangeActiveColorTheme(() => {
        void this.postEditorTokenColors();
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('gitCheckout.graph.showReflog')) {
          this.graphService.onShowReflogSettingChanged();
          void this.graph.syncGraphShowReflogContext();
          if (this.panel) {
            void this.graph.sendGraphInitial();
          }
        }
        if (event.affectsConfiguration('gitCheckout.commit.subjectWarningLength') || event.affectsConfiguration('gitCheckout.commit.subjectLengthLimit')) {
          this.changesSlot.post({ type: 'changesSubjectLimits', limits: this.gitSettings.commitSubjectLimits() });
        }
        if (event.affectsConfiguration('gitCheckout.diff.syntaxHighlighting') || event.affectsConfiguration('gitCheckout.diff.changeMarks')) {
          this.details.postCommitDiffView();
        }
        if ((event.affectsConfiguration('gitCheckout.graph.githubAvatars') || event.affectsConfiguration('gitCheckout.graph.compactBranchLabels')) && this.panel) {
          void this.graph.sendGraphInitial();
        }
        if (
          event.affectsConfiguration('gitCheckout.graph.showStashes') ||
          event.affectsConfiguration('gitCheckout.graph.showRemoteBranches') ||
          event.affectsConfiguration('gitCheckout.graph.showTags')
        ) {
          this.graphService.onGraphVisibilitySettingChanged();
          if (this.panel) {
            void this.graph.sendGraphInitial();
          }
        }
        if (
          event.affectsConfiguration('workbench.colorTheme') ||
          event.affectsConfiguration('editor.tokenColorCustomizations')
        ) {
          void this.postEditorTokenColors();
        }
      }),
    );
  }

  createOrReveal(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One);
      this.host.focused(this);
      void hideBuiltInScm();
      return;
    }

    const nonce = getNonce();
    const panel = vscode.window.createWebviewPanel(
      'gitCheckout.main',
      this.panelTitle(),
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.context.extensionUri, 'media', 'webview'),
          vscode.Uri.joinPath(this.context.extensionUri, 'resources'),
        ],
      },
    );

    // The editor tab shows the logo in the color that reads on the current theme.
    panel.iconPath = {
      light: vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'logo', 'icon-mono-light.svg'),
      dark: vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'logo', 'icon-mono-dark.svg'),
    };
    this.panel = panel;
    this.webviewReady = false;
    panel.webview.html = getWebviewHtml(
      panel.webview,
      this.context.extensionUri,
      nonce,
      this.gitSettings.graphGravatar(),
    );

    panel.webview.onDidReceiveMessage((message: WebviewMessage) => {
      void this.onWebviewMessage(message);
    });

    panel.onDidDispose(() => {
      this.operationForm.dispose();
      this.panel = undefined;
      this.webviewReady = false;
      this.pendingMessages.length = 0;
      this.host.panelClosed(this);
    });

    panel.onDidChangeViewState(() => {
      if (panel.visible) {
        void hideBuiltInScm();
      }
      if (panel.active) {
        this.host.focused(this);
      }
    });

    this.host.focused(this);
    void hideBuiltInScm();
    void this.openBottomPanel();
  }

  /** The tab's title names the repository, so several windows can be told apart. */
  panelTitle(): string {
    const root = this.activeRepoRoot();
    return root && this.repositoryRoots().length > 1
      ? l10n.t('Git Checkout: {0}', path.basename(root))
      : l10n.t('Git Checkout');
  }

  /** The repository this window shows. */
  windowRepoRoot(): string | null {
    return this.activeRepoRoot();
  }

  hasPanel(): boolean {
    return this.panel !== undefined;
  }

  /**
   * This window became the current one: the shared bottom views start over and ask it for their
   * content, and the controllers and context keys that serve one window at a time point at it.
   */
  activate(): void {
    this.changes.publishChangesViewContext();
    this.details.publishCommitDiffContext();
    this.details.publishCommitFileListContext();
    this.setBranchCompareActive(this.activeBranchCompare !== null);
    void this.setContext('gitCheckout.syncBusy', this.sync.syncBusy);
    void this.syncRepoOperationContext();
    void this.changes.updateChangesTitles();
    this.details.pushRevisionLists();
  }

  /** Context keys describe the current window only; the others stay quiet. */
  setContext(key: string, value: unknown): Thenable<unknown> {
    return this.host.owns(this)
      ? vscode.commands.executeCommand('setContext', key, value)
      : Promise.resolve();
  }

  /** Handles a message from one of the shared bottom views. */
  handleBottomViewMessage(message: WebviewMessage): Promise<void> {
    return this.onWebviewMessage(message);
  }

  openRepoTerminal(): void {
    openTerminalForRepo(this.activeRepoRoot());
  }

  /** Focuses the panel's search field; with a query, also searches for it. */
  searchCommits(query?: string): void {
    this.createOrReveal();
    this.postWhenReady({ type: 'graphFocusSearch', query });
  }

  runGraphContextCommand(id: string, context: GraphCommitContext): Promise<void> {
    log.info(`graph context command ${id}`);
    return this.onWebviewMessage(GRAPH_CONTEXT_COMMANDS[id].toMessage(context));
  }

  /** Routes a webview message through the panel (used by e2e tests). */
  sendPanelMessage(message: WebviewMessage): Promise<void> {
    return this.onWebviewMessage(message);
  }

  /** What the Merge Conflicts window last showed, for tests. */
  /** What the banner above the graph says about the active repository right now; `undefined` when it is hidden. */
  async operationBanner(): Promise<OperationBannerModel | undefined> {
    const root = this.activeRepoRoot();
    return root ? describeOperation(await this.repoOperationService.getStatus(root)) : undefined;
  }

  /** What the window shows now: its empty reason when it has no repository to show; for tests. */
  async panelState(): Promise<{ empty: boolean; emptyReason?: string; repositories: string[] }> {
    const state = await this.currentState();
    return {
      empty: state.empty,
      emptyReason: state.empty ? state.emptyReason : undefined,
      repositories: state.repositories.map((repository) => repository.rootPath),
    };
  }

  /** The commits the graph would show now, with `--all` as its filter; for tests. */
  async graphCommits(): Promise<{ subject: string; refs: string[] }[]> {
    const root = this.activeRepoRoot();
    if (!root) {
      return [];
    }
    this.graphService.setFilterRef(root, ALL_COMMITS_FILTER);
    const page = await this.graphService.loadInitial(root);
    return page.commits.map((commit) => ({
      subject: commit.subject,
      refs: commit.refs.map((ref) => `${ref.kind}:${ref.name}`),
    }));
  }

  /** The file the Merge modal is open for, if any. */
  mergeOpenPath(): string | undefined {
    return this.merge.openPath();
  }

  operationFormState(): ReturnType<OperationFormController['current']> {
    return this.operationForm.current();
  }

  async copyActiveRepoPath(): Promise<void> {
    const root = this.activeRepoRoot();
    if (!root) {
      void vscode.window.showWarningMessage(l10n.t('No Git repository is open.'));
      return;
    }
    await copyTextToClipboard(root);
  }






























  repositoryRoot(): string | null {
    return this.activeRepoRoot();
  }














  /** Roots of every repository the built-in Git extension has opened. */
  repositoryRoots(): string[] {
    return sidebarRepositoryRoots(
      this.gitService.getDiagnostics().repositories.map((repo) => repo.rootPath),
      (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath),
    );
  }

  /** Makes `repoRoot` the repository the graph and every sidebar action work on. */
  quickLaunchHost(): QuickLaunchHost {
    return {
      repoRoot: () => this.activeRepoRoot(),
      refNames: async (kind) => {
        const root = this.activeRepoRoot();
        if (!root) {
          return [];
        }
        const snapshot = await this.refsService.loadSnapshot(root);
        return (kind === 'tag' ? snapshot.tags : snapshot.branches).map((ref) => ref.name);
      },
    };
  }

  async selectRepository(repoRoot: string): Promise<void> {
    const roots = this.repositoryRoots();
    const target = roots.find((root) => sameWorktreePath(root, repoRoot));
    const active = this.activeRepoRoot();
    if (!target || (active && sameWorktreePath(active, target))) {
      return;
    }
    log.info('repository selected');
    this.selectedRepoRoot = target;
    if (this.panel) {
      await this.graph.sendGraphInitial();
      await this.changes.sendWorkingCopySnapshot();
      await this.postState('state');
    }
  }














































  dispose(): void {
    this.panel?.dispose();
    this.panel = undefined;
    this.activeBranchCompare = null;
    this.setBranchCompareActive(false);
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables.length = 0;
  }

  private async onWebviewMessage(message: WebviewMessage): Promise<void> {
    switch (message.type) {
      case 'commitViewReady':
        this.commitSlot.markReady();
        if (this.details.lastCommitPreview) {
          this.commitSlot.post(this.details.lastCommitPreview);
        }
        await this.postState('state');
        if (this.details.lastCommitSha) {
          await this.details.sendCommitDetails(this.details.lastCommitSha, this.details.lastCommitBase);
        }
        await this.postEditorTokenColors();
        this.details.postCommitDiffView();
        break;
      case 'commitFilesReady':
        this.filesSlot.markReady();
        if (this.graph.lastGraphMeta) {
          this.filesSlot.post(this.graph.lastGraphMeta);
        }
        if (this.details.lastCommitPreview) {
          this.filesSlot.post(this.details.lastCommitPreview);
        }
        if (this.details.lastCommitSha) {
          await this.details.sendCommitDetails(this.details.lastCommitSha, this.details.lastCommitBase);
        }
        break;
      case 'pathHistoryLoadMore':
      case 'pathHistorySelect':
      case 'pathHistoryClose':
      case 'pathHistoryOpenInEditor':
      case 'pathHistoryToggle':
      case 'pathHistoryReset':
      case 'pathHistoryViewOption':
        await this.pathHistory.handleMessage(message);
        break;
      case 'changesReady':
        this.changesSlot.markReady();
        this.changesSlot.post({ type: 'changesView', options: this.changesView });
        this.changesSlot.post({ type: 'changesSubjectLimits', limits: this.gitSettings.commitSubjectLimits() });
        this.details.postCommitDiffView();
        await this.postEditorTokenColors();
        await this.changes.sendWorkingCopySnapshot();
        break;
      case 'changesActions':
        await this.runLocalChangeActions(message.actions);
        break;
      case 'changesSelect': {
        const selection = message.path ? { path: message.path, side: message.side } : null;
        this.changesSlot.post({ type: 'changesSelection', selection });
        this.unstagedList.select(selection);
        this.stagedList.select(selection);
        if (selection) {
          await this.changes.sendChangesDiff(selection.path, selection.side);
        } else {
          this.changes.changesSelected = undefined;
        }
        break;
      }
      case 'changesHunk':
        await this.changes.runChangesHunk(message.op, message.patch);
        break;
      case 'changesMergeInCheckout':
        this.merge.open(message.path);
        break;
      case 'changesMergeTakeSide':
        await this.merge.takeSide(message.path, message.side);
        break;
      case 'changesMergeInEditor':
        await this.changes.openConflictInMergeEditor(message.path);
        break;
      case 'mergeReady':
      case 'mergeResolve':
      case 'mergeCancel':
      case 'mergeOpenInEditor':
        await this.merge.handle(message);
        break;
      case 'changesCommit':
        await this.changes.runChangesCommit(message.subject, message.description, message.amend, message.push === true, message.pushForm === true);
        break;
      case 'changesGenerateMessage':
        await this.changes.generateChangesMessage();
        break;
      case 'changesAmend': {
        const root = this.activeRepoRoot();
        if (root) {
          const parts = splitCommitMessage(await this.commitDetailsService.readMessage(root, 'HEAD'));
          this.changesSlot.post({ type: 'changesAmendMessage', subject: parts.subject, description: parts.description });
        }
        break;
      }
      case 'changesOpenFile': {
        const root = this.activeRepoRoot();
        if (root) {
          await vscode.window.showTextDocument(vscode.Uri.file(path.join(root, message.path)), { preview: true });
        }
        break;
      }
      case 'commitFileOpen':
        // A commit's file list opens the change in the diff editor; the Tree opens the file at the commit.
        await this.details.openSelectedCommitFile(message.sha, message.path, message.status, message.oldPath, message.baseSha);
        break;
      case 'commitDetailsSelectFile':
        await this.details.showChangedFile(message.sha, message.baseSha, message.path);
        break;
      case 'treeViewReady':
        this.treePreviewSlot.markReady();
        this.details.postCommitDiffView();
        await this.postEditorTokenColors();
        break;
      case 'commitDetailsPreview':
        this.details.lastCommitPreview = message;
        this.details.lastCommitSha = message.commit.sha;
        this.details.lastCommitBase = undefined;
        this.postMessage(message);
        break;
      case 'commitComparePreview':
        this.details.lastCommitPreview = message;
        this.details.lastCommitSha = message.commit.sha;
        this.details.lastCommitBase = message.base.sha;
        this.postMessage(message);
        break;
      case 'ready':
        await this.postState('bootstrap');
        await this.recoverInProgressUi();
        this.webviewReady = true;
        for (const pending of this.pendingMessages.splice(0)) {
          this.postMessage(pending);
        }
        break;
      case 'openQuickLaunch':
        await showGitCheckoutQuickLaunch(this.quickLaunchHost());
        break;
      case 'operationFormMessage':
        await this.operationForm.handleWebviewMessage(message);
        break;
      case 'openTerminal':
        this.openRepoTerminal();
        break;
      case 'graphReady':
        await this.graph.sendGraphInitial();
        break;
      case 'graphLoadMore':
        await this.graph.sendGraphMore();
        break;
      case 'graphSetFilter':
        await this.graph.setGraphFilter(message.ref);
        break;
      case 'graphFind':
        await this.graph.findInGraph(message.query);
        break;
      case 'graphFindCancel':
        this.graph.findGeneration += 1;
        break;
      case 'graphLoadThrough':
        await this.graph.sendGraphThrough(message.index);
        break;
      case 'graphExitReflog':
        await this.hideReflogCommits();
        break;
      case 'graphExpandMerge':
        await this.graph.expandMerge(message.sha);
        break;
      case 'graphExitActiveBranchOnly':
        await this.graph.setActiveBranchOnly(false);
        break;
      case 'graphContextCommand':
        if (Object.hasOwn(GRAPH_CONTEXT_COMMANDS, message.id)) {
          await this.runGraphContextCommand(message.id, message.context);
        }
        break;
      case 'graphCopy':
        await copyTextToClipboard(message.text);
        break;
      case 'openGitHubLink':
        await this.openGitHubLink(message.url);
        break;
      case 'syncFetch':
        await this.runFetch();
        break;
      case 'syncPull':
        await this.runPull();
        break;
      case 'syncPush':
        await this.runPush();
        break;
      case 'syncPushForceWithLease':
        await this.runPushForceWithLease();
        break;
      case 'commitStart':
        await this.runCommit();
        break;
      case 'checkoutRef':
        await this.runCheckout(message.ref);
        break;
      case 'historyMerge':
        await this.runMergeRef(message.ref);
        break;
      case 'historyRebaseOnto':
        await this.runRebaseRef(message.ref);
        break;
      case 'historyInteractiveRebase':
        await this.runInteractiveRebase(message.onto);
        break;
      case 'historyReset':
        await this.runReset(message.sha);
        break;
      case 'historyCherryPick':
        await this.runCherryPick(message.sha);
        break;
      case 'historyRevert':
        await this.runRevert(message.sha);
        break;
      case 'historyRange':
        await this.runHistoryRange(message.op, message.shas);
        break;
      case 'historyArchive':
        await this.operations.runArchive(message.ref);
        break;
      case 'historyPatchExport':
        await this.operations.handleHistoryPatchExport(message.shas, message.op, message.format);
        break;
      case 'refsPatchExport':
        await this.operations.handleRefsPatchExport(message.base, message.compare, message.op, message.format);
        break;
      case 'historyApplyPatchFromClipboard':
        await this.runApplyPatchFromClipboard();
        break;
      case 'historyCheckout':
        await this.runCheckout(message.sha);
        break;
      case 'historyCheckoutRef':
        await this.runCheckout(message.ref, message.local);
        break;
      case 'historyBranchAction':
        await this.refs.runBranchBadgeAction(message.action, message.ref);
        break;
      case 'historyDeleteBranch':
        if (message.name) {
          await this.runRefsMutate(
            message.remote
              ? { op: 'remoteBranchDelete', name: message.name }
              : { op: 'branchDelete', name: message.name },
          );
        }
        break;
      case 'historyNewBranch':
        await this.runRefsMutate({ op: 'branchCreate', startRef: message.startRef ?? message.sha });
        break;
      case 'historyNewTag':
        await this.runRefsMutate({ op: 'tagCreateAnnotated', objectRef: message.sha });
        break;
      case 'operationResolve':
      case 'operationContinue':
      case 'operationAbort':
        await this.operation.handleWebviewMessage(message);
        break;
      case 'workingCopyReady':
        await this.changes.sendWorkingCopySnapshot();
        break;
      case 'workingCopyAction':
        await this.changes.handleWorkingCopyAction(message.action);
        break;
      case 'workingCopyRequestDiff':
        await this.changes.sendWorkingCopyFileDiff(message.path, message.side, message.options);
        break;
      case 'workingCopyOpenInDiffEditor':
        await this.changes.openWorkingCopyInDiffEditor(message.path, message.side);
        break;
      case 'workingCopyPatchAction':
        await this.runLocalPatch(message.action);
        break;
      case 'stashWorkingCopyPath':
        await this.stash.stashWorkingCopyPath(message.path);
        break;
      case 'stashApply':
        if (message.selector) {
          await this.runApplyStash(message.selector);
        }
        break;
      case 'stashPop':
        if (message.selector) {
          await this.runPopStash(message.selector);
        }
        break;
      case 'stashDrop':
        if (message.selector) {
          await this.runDropStashes([message.selector]);
        }
        break;
      case 'workingCopyRequestBinaryChunk':
        await this.changes.sendWorkingCopyBinaryChunk(message.blobRef, message.offset, message.maxBytes);
        break;
      case 'commitTreeSetRevision':
        await this.details.sendCommitTreePage(message.revision);
        break;
      case 'diffViewOption':
        this.details.applyDiffViewOption(message.option);
        break;
      case 'commitTreeOpenInEditor':
        await this.details.openCommitTreeFileInEditor(message.revision, message.path);
        break;
      case 'commitTreeOpen':
        await this.details.openCommitTreeFile(message.revision, message.path);
        break;
      case 'commitDetailsSelect':
        await this.details.sendCommitDetails(message.sha, message.baseSha);
        break;
      case 'commitDetailsOpenFile':
        await this.details.openSelectedCommitFile(message.sha, message.path, message.status, message.oldPath, message.baseSha);
        break;
      case 'rebaseReady':
      case 'rebaseRefresh':
      case 'rebaseSetOnto':
      case 'rebaseSetUpstream':
      case 'rebaseToggleUpdateRefs':
      case 'rebaseToggleStash':
      case 'rebaseSetCommand':
      case 'rebaseSetMessage':
      case 'rebaseEditMessage':
      case 'rebaseRequestCommitDetails':
      case 'rebaseReorder':
      case 'rebaseSquashLast':
      case 'rebaseCombineSelected':
      case 'rebaseAutosquashFixups':
      case 'rebaseStart':
      case 'rebaseContinue':
      case 'rebaseSkip':
      case 'rebaseAbort':
      case 'rebaseDismiss':
        await this.interactiveRebase.handleWebviewMessage(message);
        break;
    }
  }

  /** Updates command enablement while a merge/rebase/cherry-pick/revert/bisect is in progress. */
  async syncRepoOperationContext(): Promise<void> {
    const root = this.activeRepoRoot();
    if (!root) {
      await this.setRepoOperationActive(false);
      await this.bisect.setBisectActive(false);
      return;
    }
    const operation = await this.repoOperationService.getStatus(root);
    await this.setRepoOperationActive(operation.active);
    await this.bisect.setBisectActive(operation.kind === 'bisect');
  }

  private async recoverInProgressUi(): Promise<void> {
    const root = this.activeRepoRoot();
    if (!root || !this.panel) {
      return;
    }
    const operation = await this.repoOperationService.getStatus(root);
    await this.setRepoOperationActive(operation.active);
    await this.bisect.setBisectActive(operation.kind === 'bisect');
    if (!operation.active && !operation.conflicted) {
      return;
    }
    if (planInProgressRecovery(operation).restoreBisect) {
      await this.publishBisectSession();
    }
  }






  private async setRepoOperationActive(active: boolean): Promise<void> {
    await this.setContext('gitCheckout.repoOperationActive', active);
  }


  setBranchCompareActive(active: boolean): void {
    void this.setContext('gitCheckout.branchCompareActive', active);
  }














  graphReady(): boolean {
    return this.gitService.getDiagnostics().bindingState === 'ready';
  }













  /** Connects the History modal's controller, which asks this panel to show and feed it. */
  /** This window's File, Folder and Hunk History. */
  pathHistoryPanel(): PathHistoryPanel {
    return this.pathHistory;
  }

  private attachPathHistory(controller: PathHistoryPanel): void {
    controller.attach({
      show: () => this.createOrReveal(),
      repoRoot: () => this.activeRepoRoot(),
      post: (message) => this.postWhenReady(message),
      loadDiff: async (root, sha, path) => {
        const diff = await this.commitDetailsService.diffFile(root, sha, path, this.commitDiffView);
        if (!diff.binary) {
          return diff;
        }
        const parent = await this.commitDetailsService.resolveParent(root, sha);
        return { ...diff, nonText: await this.commitDetailsService.binaryPreview(root, parent, sha, path) };
      },
      openAtRevision: (revision, path) => this.details.openCommitTreeFileInEditor(revision, path),
      applyViewOption: (option) => this.details.applyDiffViewOption(option),
    });
  }







  private async postEditorTokenColors(): Promise<void> {
    try {
      const colors =
        (await readActiveEditorTokenColors()) ?? editorTokenColorsFromRules([], undefined);
      this.commitSlot.post({ type: 'editorTokenColors', colors });
      this.treePreviewSlot.post({ type: 'editorTokenColors', colors });
      this.changesSlot.post({ type: 'editorTokenColors', colors });
    } catch (error) {
      log.warn('could not read editor token colors', error);
    }
  }


  private async openGitHubLink(url: string): Promise<void> {
    const root = this.activeRepoRoot();
    const github = root ? await githubRepositoryFor(root) : null;
    await openGitHubIssueLink(url, github);
  }





















  handleGraphError(error: unknown): void {
    if (error instanceof RepositoryNotOpenError) {
      // The repository closed while the page was loading; there is nothing to tell the person.
      log.warn('Git graph skipped: the repository is no longer open', error);
      this.postMessage({ type: 'graphLoadFailed' });
      return;
    }
    const message =
      error instanceof GitCliError ? `${error.code}: ${error.message}` : String(error);
    log.error(`Git graph error: ${message}`, error);
    void vscode.window.showErrorMessage(message);
    // The graph only needs to know that the page it waited for is not coming.
    this.postMessage({ type: 'graphLoadFailed' });
  }

  async handleOpError(repoRoot: string, error: unknown): Promise<void> {
    if (error instanceof RepositoryNotOpenError) {
      log.warn('Git operation skipped: the repository is no longer open', error);
      return;
    }
    log.error('Git operation failed', error);
    const operation = await this.repoOperationService.getStatus(repoRoot);
    if (operation.conflicted || operation.active) {
      void vscode.window.showInformationMessage(
        operation.summary || l10n.t('The Git operation stopped because of conflicts. Resolve them in Source Control.'),
      );
      return;
    }
    const message =
      error instanceof GitCliError ? `${error.code}: ${error.message}` : String(error);
    const remediation = formatSigningFailure(error);
    if (remediation) {
      log.error(remediation);
      const choice = await vscode.window.showErrorMessage(message, l10n.t('Show Output'));
      if (choice === l10n.t('Show Output')) {
        await vscode.commands.executeCommand('gitCheckout.showOutput');
      }
      return;
    }
    void vscode.window.showErrorMessage(message);
  }

  activeRepoRoot(): string | null {
    return resolveActiveRepoRoot(this.repositoryRoots(), this.selectedRepoRoot);
  }

  private async currentState() {
    const diagnostics = this.gitService.getDiagnostics();
    const active = this.activeRepoRoot();
    const headShort = active ? (this.headShortByRepo.get(active) ?? null) : null;
    const layout = 'horizontal' as const;
    // Three independent reads: run them together, not one after another.
    const [sync, worktree, operation] = await Promise.all([
      active
        ? this.remoteSyncService.getSyncStatus(active, this.sync.syncBusy)
        : { ahead: null, behind: null, upstream: null, busy: this.sync.syncBusy },
      active ? this.workingTreeService.getStatus(active) : { dirty: false, stagedCount: 0, unstagedCount: 0 },
      active ? this.repoOperationService.getStatus(active) : IDLE_REPO_OPERATION,
    ]);
    const state = buildUiState(diagnostics, headShort, layout, sync, worktree, operation);
    if (!state.empty && active) {
      return { ...state, activeRepoRoot: active };
    }
    return state;
  }

  /** Refreshes of the same kind that arrive together share runs; see `coalesced`. */
  private readonly postStateRefresh = coalesced(() => this.postStateNow('state'));

  postState(kind: 'bootstrap' | 'state'): Promise<void> {
    return kind === 'state' ? this.postStateRefresh() : this.postStateNow(kind);
  }

  private async postStateNow(kind: 'bootstrap' | 'state'): Promise<void> {
    const state = await this.currentState();
    await this.setRepoOperationActive(!state.empty && state.operation.active);
    this.postMessage({ type: kind, state });
  }

  postMessage(message: HostMessage): void {
    if (this.panel) {
      void this.panel.webview.postMessage(message);
    }
    for (const pane of bottomViewsFor(message.type)) {
      this[`${pane}Slot`].post(message);
    }
  }

  private async openBottomPanel(): Promise<void> {
    await vscode.commands.executeCommand('setContext', 'gitCheckout.panelOpen', true);
    const focus = this.bottomFocusCommand;
    this.bottomFocusCommand = COMMIT_TAB_FOCUS_COMMAND;
    await vscode.commands.executeCommand(focus);
  }

  /** Messages sent before the webview script loads are dropped, so queue until 'ready'. */
  postWhenReady(message: HostMessage): void {
    if (this.webviewReady) {
      this.postMessage(message);
    } else {
      this.pendingMessages.push(message);
    }
  }

  runFetch(arg?: unknown, initialRemote?: string): Promise<void> {
    return this.sync.runFetch(arg, initialRemote);
  }

  runPull(arg?: unknown, initial?: { remote: string; branch: string }): Promise<void> {
    return this.sync.runPull(arg, initial);
  }

  runPush(arg?: unknown, initialBranch?: string): Promise<boolean> {
    return this.sync.runPush(arg, initialBranch);
  }

  runPushForceWithLease(): Promise<void> {
    return this.sync.runPushForceWithLease();
  }

  runPullBranch(branchName: string): Promise<void> {
    return this.sync.runPullBranch(branchName);
  }

  async runOpenPullRequest(branchName: string): Promise<void> {
    const root = this.activeRepoRoot();
    if (root) {
      await openPullRequestPage(root, branchName);
    }
  }

  runPushBranch(branchName: string): Promise<void> {
    return this.sync.runPushBranch(branchName);
  }

  runFastForward(branchName: string): Promise<void> {
    return this.sync.runFastForward(branchName);
  }

  runPushTag(tagName: string): Promise<void> {
    return this.sync.runPushTag(tagName);
  }


  updateChangesView(change: Partial<ChangesViewOptions>): void {
    return this.changes.updateChangesView(change);
  }

  stageAllChanges(): Promise<void> {
    return this.changes.stageAllChanges();
  }

  unstageAllChanges(): Promise<void> {
    return this.changes.unstageAllChanges();
  }

  toggleChangesHideUntracked(): void {
    return this.changes.toggleChangesHideUntracked();
  }

  toggleChangesShowIgnored(): void {
    return this.changes.toggleChangesShowIgnored();
  }

  runChangesFileCommand(
    command: 'stage' | 'unstage' | 'discard' | 'open' | 'reveal' | 'copyPath' | 'history' | 'blame' | 'externalDiff',
    arg: unknown,
    selected?: unknown,
  ): Promise<void> {
    return this.changes.runChangesFileCommand(command, arg, selected);
  }

  resolveConflictsWith(side: 'incoming' | 'current', arg: unknown, selected?: unknown): Promise<void> {
    return this.changes.resolveConflictsWith(side, arg, selected);
  }

  runLocalChangeActions(
    actions: readonly { op: 'stage' | 'unstage' | 'discard'; path: string }[],
  ): Promise<void> {
    return this.changes.runLocalChangeActions(actions);
  }

  runLocalPatch(action: WorkingCopyPatchAction): Promise<void> {
    return this.changes.runLocalPatch(action);
  }


  commitFilesSnapshot(): { sha: string; baseSha?: string; files: CommitFileChangeDto[] } | undefined {
    return this.details.commitFilesSnapshot();
  }

  setCommitFileListMode(mode: CommitFileListMode): void {
    return this.details.setCommitFileListMode(mode);
  }

  navigateCommitDiff(direction: 'previous' | 'next'): void {
    return this.details.navigateCommitDiff(direction);
  }

  toggleCommitDiffIgnoreWhitespace(): void {
    return this.details.toggleCommitDiffIgnoreWhitespace();
  }

  toggleCommitDiffInvisibles(): void {
    return this.details.toggleCommitDiffInvisibles();
  }

  changeCommitDiffContext(direction: 1 | -1): void {
    return this.details.changeCommitDiffContext(direction);
  }

  toggleCommitDiffWrap(): void {
    return this.details.toggleCommitDiffWrap();
  }

  toggleCommitDiffFullFile(): void {
    return this.details.toggleCommitDiffFullFile();
  }

  toggleCommitDiffSideBySide(): void {
    return this.details.toggleCommitDiffSideBySide();
  }

  swapCommitDiffSides(): void {
    return this.details.swapCommitDiffSides();
  }

  runCommitFileAction(action: CommitFileAction, arg: unknown, selected?: unknown): Promise<void> {
    return this.details.runCommitFileAction(action, arg, selected);
  }


  reloadGraphOnHeadChange(): Promise<void> {
    return this.graph.reloadGraphOnHeadChange();
  }

  collapseMerges(): Promise<void> {
    return this.graph.collapseMerges();
  }

  showAllMerges(): Promise<void> {
    return this.graph.showAllMerges();
  }

  toggleActiveBranchOnly(): Promise<void> {
    return this.graph.toggleActiveBranchOnly();
  }

  /** A keyboard shortcut for the graph: the commits it acts on are the ones selected in the webview. */
  graphShortcut(action: 'findNext' | 'findPrevious' | 'copy' | 'remove'): void {
    this.createOrReveal();
    this.postWhenReady({ type: 'graphShortcut', action });
  }

  /** A keyboard shortcut for the commit form in the Changes tab. */
  changesShortcut(action: 'commit' | 'commitAndPush' | 'focusCommit'): void {
    this.changesSlot.post({ type: 'changesShortcut', action });
  }

  runQuickSync(kind: 'fetch' | 'pull' | 'push'): Promise<void> {
    return this.sync.runQuick(kind);
  }

  showReflogCommits(): Promise<void> {
    return this.graph.showReflogCommits();
  }

  hideReflogCommits(): Promise<void> {
    return this.graph.hideReflogCommits();
  }

  showRefInGraph(ref: string): Promise<void> {
    return this.graph.showRefInGraph(ref);
  }

  revealRefInGraph(ref: string): Promise<void> {
    return this.graph.revealRefInGraph(ref);
  }

  /** Scrolls the graph to the checked-out commit. */
  async revealHead(): Promise<void> {
    const root = this.activeRepoRoot();
    if (!root) {
      void vscode.window.showWarningMessage(l10n.t('No Git repository is open.'));
      return;
    }
    await this.graph.revealRefInGraph(this.graphService.resolveHeadRef(root) ?? 'HEAD');
  }

  /** Shows the repository's folder in the system's file manager. */
  async revealRepository(): Promise<void> {
    const root = this.activeRepoRoot();
    if (!root) {
      void vscode.window.showWarningMessage(l10n.t('No Git repository is open.'));
      return;
    }
    await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(root));
  }

  /** Reads the repository again: refs, the working copy and the graph. */
  async refreshAll(): Promise<void> {
    log.info('refresh');
    this._onDidChangeRefs.fire();
    await Promise.all([this.postState('state'), this.changes.sendWorkingCopySnapshot()]);
    await this.graph.reloadGraphOnHeadChange(true);
  }


  runBisectStart(): Promise<void> {
    return this.bisect.runBisectStart();
  }

  runBisectMark(mark: BisectMark, rev?: string): Promise<void> {
    return this.bisect.runBisectMark(mark, rev);
  }

  runBisectReset(): Promise<void> {
    return this.bisect.runBisectReset();
  }

  publishBisectSession(): Promise<void> {
    return this.bisect.publishBisectSession();
  }


  runCheckout(ref: string, localBranch = false): Promise<void> {
    return this.operations.runCheckout(ref, localBranch);
  }

  runCheckoutPrompt(): Promise<void> {
    return this.operations.runCheckoutPrompt();
  }

  runMergeRef(ref: string): Promise<void> {
    return this.operations.runMergeRef(ref);
  }

  runMergePrompt(): Promise<void> {
    return this.operations.runMergePrompt();
  }

  runRebaseRef(
    ref: string,
    sourceBranch?: string,
    beforeRebase?: (repoRoot: string, token: vscode.CancellationToken) => Promise<void>,
  ): Promise<void> {
    return this.operations.runRebaseRef(ref, sourceBranch);
  }

  runRebasePrompt(): Promise<void> {
    return this.operations.runRebasePrompt();
  }

  runInteractiveRebase(onto: string): Promise<void> {
    return this.operations.runInteractiveRebase(onto);
  }

  runBranchDrop(source: string, target: string): Promise<void> {
    return this.operations.runBranchDrop(source, target);
  }

  runReset(sha: string): Promise<void> {
    return this.operations.runReset(sha);
  }

  runResetPrompt(): Promise<void> {
    return this.operations.runResetPrompt();
  }

  runCherryPick(sha: string): Promise<void> {
    return this.operations.runCherryPick(sha);
  }

  runCherryPickPrompt(): Promise<void> {
    return this.operations.runCherryPickPrompt();
  }

  runRevert(sha: string): Promise<void> {
    return this.operations.runRevert(sha);
  }

  runRevertPrompt(): Promise<void> {
    return this.operations.runRevertPrompt();
  }

  runHistoryRange(op: 'squash' | 'drop' | 'cherryPick', shas: string[]): Promise<void> {
    return this.operations.runHistoryRange(op, shas);
  }

  runCompareCopyPatch(): Promise<void> {
    return this.operations.runCompareCopyPatch();
  }

  runCompareSavePatch(): Promise<void> {
    return this.operations.runCompareSavePatch();
  }

  runApplyPatchFromClipboard(): Promise<void> {
    return this.operations.runApplyPatchFromClipboard();
  }

  runUndo(): Promise<void> {
    return this.operations.runUndo();
  }

  runCreatePatch(options?: { revision?: string; saveTo?: string }): Promise<void> {
    return this.operations.runCreatePatch(options);
  }

  runApplyPatch(): Promise<void> {
    return this.operations.runApplyPatch();
  }

  runCommit(): Promise<void> {
    return this.operations.runCommit();
  }

  runGitFlow(arg?: unknown): Promise<GitFlowRunResult | undefined> {
    return this.operations.runGitFlow(arg);
  }

  runToggleSigning(arg?: unknown): Promise<boolean | undefined> {
    return this.operations.runToggleSigning(arg);
  }


  runCreateStash(arg?: unknown): Promise<void> {
    return this.stash.runCreateStash(arg);
  }

  runApplyStash(selector: string): Promise<void> {
    return this.stash.runApplyStash(selector);
  }

  runRenameStash(selector: string): Promise<void> {
    return this.stash.runRenameStash(selector);
  }

  runSaveStashPatch(selector: string): Promise<void> {
    return this.stash.runSaveStashPatch(selector);
  }

  runPopStash(selector: string): Promise<void> {
    return this.stash.runPopStash(selector);
  }

  runDropStashes(selectors: readonly string[]): Promise<void> {
    return this.stash.runDropStashes(selectors);
  }

  runClearStashes(): Promise<void> {
    return this.stash.runClearStashes();
  }

  runShowStash(selector: string): Promise<void> {
    return this.stash.runShowStash(selector);
  }

  stashSelection(
    action: Extract<WorkingCopyPatchAction, { op: 'stashHunk' | 'stashLine' }>,
  ): Promise<void> {
    return this.stash.stashSelection(action);
  }


  runClone(arg?: unknown): Promise<void> {
    return this.clones.runClone(arg);
  }

  runCreateWorktree(arg?: unknown): Promise<void> {
    return this.worktrees.runCreateWorktree(arg);
  }

  runOpenWorktree(worktreePath: string): Promise<void> {
    return this.worktrees.runOpenWorktree(worktreePath);
  }

  runRevealWorktree(worktreePath: string): Promise<void> {
    return this.worktrees.runRevealWorktree(worktreePath);
  }

  runCopyWorktreePath(worktreePath: string): Promise<void> {
    return this.worktrees.runCopyWorktreePath(worktreePath);
  }

  runCheckoutAsWorktree(branchName: string): Promise<void> {
    return this.worktrees.runCheckoutAsWorktree(branchName);
  }

  runDeleteWorktree(worktreePath: string): Promise<void> {
    return this.worktrees.runDeleteWorktree(worktreePath);
  }


  runAddSubmodule(): Promise<void> {
    return this.submodules.runAddSubmodule();
  }

  runInitSubmodules(paths: readonly string[] = []): Promise<void> {
    return this.submodules.runInitSubmodules(paths);
  }

  runUpdateSubmodules(paths: readonly string[] = []): Promise<void> {
    return this.submodules.runUpdateSubmodules(paths);
  }

  runSyncSubmodules(paths: readonly string[] = []): Promise<void> {
    return this.submodules.runSyncSubmodules(paths);
  }

  runOpenSubmodule(relPath: string, initialize = false): Promise<void> {
    return this.submodules.runOpenSubmodule(relPath, initialize);
  }

  runCopySubmodulePath(relPath: string): Promise<void> {
    return this.submodules.runCopySubmodulePath(relPath);
  }

  runOpenSubmoduleInTerminal(relPath: string): void {
    return this.submodules.runOpenSubmoduleInTerminal(relPath);
  }

  runRevealSubmodule(relPath: string): Promise<void> {
    return this.submodules.runRevealSubmodule(relPath);
  }

  runDeleteSubmodule(relPath: string): Promise<void> {
    return this.submodules.runDeleteSubmodule(relPath);
  }

  showSubmoduleDiff(relPath: string, side: WorkingCopyDiffSide): void {
    return this.submodules.showSubmoduleDiff(relPath, side);
  }


  runCopyBranchName(branchName: string): Promise<void> {
    return this.refs.runCopyBranchName(branchName);
  }

  runShowTagDetails(tagName: string): Promise<void> {
    return this.refs.runShowTagDetails(tagName);
  }

  runRefsCompare(base: string, compare: string): Promise<void> {
    return this.refs.runRefsCompare(base, compare);
  }

  runRefsMutate(mutate: RefsMutateOp): Promise<void> {
    return this.refs.runRefsMutate(mutate);
  }

  loadSidebarData(repoRoot?: string): Promise<{
    snapshot: RefsSnapshotDto;
    worktree: WorktreeStatusDto;
    stashes: StashEntryDto[];
    worktrees: GitWorktreeDto[];
    submodules: GitSubmoduleDto[];
  } | null> {
    return this.refs.loadSidebarData(repoRoot);
  }

  /** A second request while every commit is already shown jumps to HEAD. */
  async showAllCommits(): Promise<void> {
    const root = this.activeRepoRoot();
    if (root && this.graphReady() && this.graphService.getFilterRef(root) === ALL_COMMITS_FILTER) {
      return this.revealHead();
    }
    return this.refs.showAllCommits();
  }

  showLocalChanges(): void {
    return this.refs.showLocalChanges();
  }

}
