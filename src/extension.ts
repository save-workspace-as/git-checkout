import { platformCommandIds } from './shared/app/platformCommands';
import './installL10n';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { formatDiagnostics } from './core/diagnostics';
import { GitCheckoutContentProvider } from './core/gitCheckoutContentProvider';
import { GIT_CHECKOUT_SCHEME } from './core/gitCheckoutUri';
import { getGitCliRegistry } from './core/gitCliRegistry';
import { runGitCliSmoke } from './core/gitCliSmoke';
import {
  GitExtensionService,
  setGitExtensionService,
} from './core/gitExtensionService';
import { GitRevisionContentService } from './core/gitRevisionContentService';
import {
  getWatchDebounceMs,
  GitWatchService,
} from './core/gitWatchService';
import { createLogger, getLogChannel } from './log';
import { bisectCommitSha } from './shared/bisect/bisectProtocol';
import type { GraphCommitContext } from './shared/graph/graphProtocol';
import { isWorkingCopySubmoduleContext } from './shared/changes/workingCopyContext';
import { DiagnosticsStatusBar } from './ui/diagnosticsStatusBar';
import { registerGitCheckoutSidebar } from './ui/gitCheckoutSidebar';
import { restoreBuiltInScm } from './ui/scmVisibility';
import type { SidebarNode } from './ui/sidebarTreeModel';
import type { GitCheckoutPanelManager } from './panel/gitCheckoutPanelManager';
import type { ChangeNode } from './shared/changes/changesTree';
import type { RevisionNode } from './shared/history/revisionTree';
import { GitCheckoutWindows } from './panel/gitCheckoutWindows';
import { rememberBranchCheckoutIn } from './features/branches/branchCreateHost';
import { AutoFetch } from './features/sync/autoFetch';
import { RepoOperationService } from './features/operations/repoOperationService';
import { createWorkspaceGitCheckoutSettings } from './core/gitCheckoutSettings';
import { GRAPH_CONTEXT_COMMANDS } from './features/graph/graphContextCommands';
import type { WebviewMessage } from './shared/protocol';
import { registerExtensibilityCommands } from './extensibility/registerExtensibilityCommands';
import { showGitCheckoutQuickLaunch } from './panel/quickLaunch';
import { LineBlameController } from './features/blame/LineBlameController';
import { LineBlameService } from './features/blame/lineBlameService';
import { ignoreRevsEnabled } from './features/blame/blameSettings';
import { RemoteLinkController } from './features/history/RemoteLinkController';
import { FileBlameController } from './features/blame/FileBlameController';
import { BlameCodeLensProvider } from './features/blame/BlameCodeLensProvider';

const log = createLogger('extension');

/** Returned from activate(); used by the e2e tests. */
export interface GitCheckoutApi {
  /** The first repository's view. */
  sidebar: vscode.TreeDataProvider<SidebarNode>;
  /** One view per repository slot, in repository order. */
  sidebars: vscode.TreeDataProvider<SidebarNode>[];
  /** The number on the Git Checkout icon in the Activity Bar (e2e only). */
  activityBadge(): number | undefined;
  /** Sends a message as if it came from the main panel webview (e2e only). */
  sendPanelMessage(message: WebviewMessage): Promise<void>;
  /** Makes the repository at `repoRoot` the one commands and the bottom views act on (e2e only). */
  selectRepository(repoRoot: string): Promise<void>;
  /** What the Merge Conflicts window last showed (e2e only). */
  operationFormState(): ReturnType<GitCheckoutPanelManager['operationFormState']>;
  mergeOpenPath(): string | undefined;
  /** What blame says about the line the cursor is on, as shown at its end (e2e only). */
  lineBlame(): { sha: string; text: string } | undefined;
  /** What the gutter blame of the active file shows on each line, 1-based; undefined when it is off (e2e only). */
  fileBlame(): Map<number, string> | undefined;
  operationBanner(): ReturnType<GitCheckoutPanelManager['operationBanner']>;
  /** Whether the window has a repository to show and, if not, why (e2e only). */
  panelState(): ReturnType<GitCheckoutPanelManager['panelState']>;
  /** The commits and ref labels the graph shows for all commits (e2e only). */
  graphCommits(): ReturnType<GitCheckoutPanelManager['graphCommits']>;
  /** Runs one round of background fetching now (e2e only). */
  autoFetchNow(): Promise<void>;
  /** The Unstaged and Staged lists' contents (e2e only). */
  changesLists: Record<'unstaged' | 'staged', vscode.TreeDataProvider<ChangeNode>>;
  /** A commit's changed files and the File Tree (e2e only). */
  revisionLists: Record<'commitFiles' | 'tree', vscode.TreeDataProvider<RevisionNode>>;
  /** The files the Changes tab lists. */
  commitFiles(): ReturnType<GitCheckoutPanelManager['commitFilesSnapshot']>;
}

export async function activate(context: vscode.ExtensionContext): Promise<GitCheckoutApi> {
  const outputChannel = getLogChannel();
  context.subscriptions.push(outputChannel);

  rememberBranchCheckoutIn(context.globalState);
  const cliRegistry = getGitCliRegistry();
  context.subscriptions.push(cliRegistry);

  const gitService = new GitExtensionService();
  setGitExtensionService(gitService);
  context.subscriptions.push(gitService);

  await gitService.initialize();

  const watchService = new GitWatchService(
    gitService,
    cliRegistry,
    getWatchDebounceMs(),
  );
  context.subscriptions.push(watchService);

  const revisionContent = new GitRevisionContentService(gitService, cliRegistry);
  const gitCheckoutContentProvider = new GitCheckoutContentProvider(revisionContent);
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(
      GIT_CHECKOUT_SCHEME,
      gitCheckoutContentProvider,
    ),
  );

  const windows = new GitCheckoutWindows(
    context,
    gitService,
    watchService,
    cliRegistry,
  );
  context.subscriptions.push(windows);
  const panelManager = windows.facade();

  const { providers: sidebars, badge: sidebarBadge } = registerGitCheckoutSidebar(context, panelManager, gitService, watchService);

  const statusBar = new DiagnosticsStatusBar(gitService);
  context.subscriptions.push(statusBar);
  context.subscriptions.push(
    gitService.onDidChangeDiagnostics(() => {
      statusBar.refresh();
      const roots = gitService.getRepositories().map((r) => r.rootUri.fsPath);
      cliRegistry.syncOpenRepositories(roots);
      watchService.syncRepositories();
    }),
  );

  watchService.syncRepositories();
  void panelManager.syncRepoOperationContext();

  const remoteLinks = new RemoteLinkController(gitService, cliRegistry, () => panelManager.activeRepoRoot() ?? undefined);
  context.subscriptions.push(
    vscode.commands.registerCommand('gitCheckout.remote.openFile', (arg?: unknown) => remoteLinks.openFile(arg)),
    vscode.commands.registerCommand('gitCheckout.remote.copyFileLink', (arg?: unknown) => remoteLinks.copyFileLink(arg)),
    vscode.commands.registerCommand('gitCheckout.remote.openRepository', () => remoteLinks.openRepository()),
    vscode.commands.registerCommand('gitCheckout.graph.openOnGitHub', (graphContext?: GraphCommitContext) => remoteLinks.openCommit(graphContext?.sha)),
    vscode.commands.registerCommand('gitCheckout.graph.copyGitHubLink', (graphContext?: GraphCommitContext) => remoteLinks.copyCommitLink(graphContext?.sha)),
  );
  const blameService = new LineBlameService(cliRegistry, ignoreRevsEnabled);
  const lineBlame = new LineBlameController(gitService, blameService, panelManager, watchService.onDidRefresh);
  const fileBlame = new FileBlameController(gitService, blameService, (target) => lineBlame.hoverMarkdown(target), watchService.onDidRefresh);
  const codeLens = new BlameCodeLensProvider(gitService, blameService);
  context.subscriptions.push(
    lineBlame,
    fileBlame,
    codeLens,
    vscode.languages.registerCodeLensProvider({ scheme: 'file' }, codeLens),
    watchService.onDidRefresh(() => codeLens.refresh()),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('gitCheckout.codeLens')) {
        codeLens.refresh();
      }
    }),
    vscode.commands.registerCommand('gitCheckout.blame.toggleFile', () => fileBlame.toggle()),
    vscode.commands.registerCommand('gitCheckout.blame.toggleCodeLens', async () => {
      const config = vscode.workspace.getConfiguration('gitCheckout.codeLens');
      await config.update('enabled', !config.get<boolean>('enabled', false), vscode.ConfigurationTarget.Global);
    }),
    vscode.commands.registerCommand('gitCheckout.blame.toggleInline', () => lineBlame.toggleInline()),
    vscode.commands.registerCommand('gitCheckout.blame.copyHash', (arg?: unknown) => lineBlame.copyHash(arg)),
    vscode.commands.registerCommand('gitCheckout.blame.openCommit', (arg?: unknown) => lineBlame.openCommit(arg)),
    vscode.commands.registerCommand('gitCheckout.blame.openChanges', (arg?: unknown) => lineBlame.openChanges(arg)),
    vscode.commands.registerCommand('gitCheckout.blame.openInBlame', (arg?: unknown) => lineBlame.openInBlame(arg)),
    vscode.commands.registerCommand('gitCheckout.blame.stepBack', (arg?: unknown) => lineBlame.blameBefore(arg)),
    vscode.commands.registerCommand('gitCheckout.blame.lineHistory', (arg?: unknown) => lineBlame.lineHistory(arg)),
  );

  const settings = createWorkspaceGitCheckoutSettings();
  const operations = new RepoOperationService(gitService, cliRegistry);
  const autoFetch = new AutoFetch({
    enabled: () => settings.autoFetchEnabled(),
    intervalSeconds: () => settings.autoFetchIntervalSeconds(),
    roots: () => gitService.getRepositories().map((repo) => repo.rootUri.fsPath),
    windowActive: () => vscode.window.state.focused,
    operationActive: async (root) => (await operations.getStatus(root)).active,
    hasRemotes: async (root) => (await cliRegistry.getOrCreate(root).execRead(['remote'])).stdout.trim().length > 0,
    async fetch(root) {
      await cliRegistry.getOrCreate(root).execWrite(
        ['fetch', '--all', ...(settings.fetchIncludeTags() ? ['--tags'] : [])],
        { network: true, timeoutMs: settings.networkTimeoutMs() },
      );
    },
  });
  autoFetch.start();
  context.subscriptions.push(
    { dispose: () => autoFetch.stop() },
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('gitCheckout.autoFetch')) { autoFetch.reschedule(); }
    }),
  );

  log.info(formatDiagnostics(gitService.getDiagnostics()));
  void runGitCliSmoke(gitService, false);

  registerExtensibilityCommands(context);

  context.subscriptions.push(
    vscode.commands.registerCommand('gitCheckout.open', () => {
      panelManager.createOrReveal();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('gitCheckout.quickLaunch', () => {
      void showGitCheckoutQuickLaunch(panelManager.quickLaunchHost());
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('gitCheckout.openRepoTerminal', () => {
      panelManager.openRepoTerminal();
    }),
    vscode.commands.registerCommand('gitCheckout.graph.revealHead', () => panelManager.revealHead()),
    vscode.commands.registerCommand('gitCheckout.refresh', () => panelManager.refreshAll()),
    // Shortcuts are changed where VS Code keeps all of them: its Keyboard Shortcuts editor, filtered to ours.
    vscode.commands.registerCommand('gitCheckout.openKeyboardShortcuts', () =>
      vscode.commands.executeCommand('workbench.action.openGlobalKeybindings', '@ext:rkonit.gitcheckout'),
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('gitCheckout.copyActiveRepoPath', () => {
      void panelManager.copyActiveRepoPath();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('gitCheckout.restoreBuiltInScm', () => {
      void restoreBuiltInScm();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('gitCheckout.showOutput', () => {
      outputChannel.show(true);
      log.info(formatDiagnostics(gitService.getDiagnostics()));
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('gitCheckout.verifyGitCli', async () => {
      outputChannel.show(true);
      await runGitCliSmoke(gitService, true);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('gitCheckout.verifyWatch', () => {
      outputChannel.show(true);
      log.info(watchService.formatVerifyReport());
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('gitCheckout.reresolveWatchers', async () => {
      outputChannel.show(true);
      await watchService.reresolveAll();
      log.info(watchService.formatVerifyReport());
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('gitCheckout.fetch', (arg?: unknown) => panelManager.runFetch(arg)),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('gitCheckout.pull', (arg?: unknown) => panelManager.runPull(arg)),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('gitCheckout.push', (arg?: unknown) => panelManager.runPush(arg)),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('gitCheckout.pushForceWithLease', () => {
      void panelManager.runPushForceWithLease();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('gitCheckout.commit', () => {
      void panelManager.runCommit();
    }),
    vscode.commands.registerCommand('gitCheckout.gitFlow', (arg?: unknown) =>
      panelManager.runGitFlow(arg),
    ),
    vscode.commands.registerCommand('gitCheckout.toggleSigning', (arg?: unknown) =>
      panelManager.runToggleSigning(arg),
    ),
    vscode.commands.registerCommand('gitCheckout.checkout', () => {
      void panelManager.runCheckoutPrompt();
    }),
    vscode.commands.registerCommand('gitCheckout.merge', () => {
      void panelManager.runMergePrompt();
    }),
    vscode.commands.registerCommand('gitCheckout.rebase', () => {
      void panelManager.runRebasePrompt();
    }),
    vscode.commands.registerCommand('gitCheckout.interactiveRebase', async () => {
      const repo = gitService.getRepositories()[0];
      if (!repo) {
        void vscode.window.showWarningMessage(l10n.t('No Git repository is open.'));
        return;
      }
      const onto = await vscode.window.showInputBox({
        prompt: l10n.t('Rebase onto a branch, tag, or commit'),
        placeHolder: l10n.t('e.g. main, origin/main'),
        value: 'HEAD',
      });
      if (!onto?.trim()) {
        return;
      }
      panelManager.createOrReveal();
      await panelManager.runInteractiveRebase(onto.trim());
    }),
    vscode.commands.registerCommand('gitCheckout.reset', () => {
      void panelManager.runResetPrompt();
    }),
    vscode.commands.registerCommand('gitCheckout.cherryPick', () => {
      void panelManager.runCherryPickPrompt();
    }),
    vscode.commands.registerCommand('gitCheckout.revert', () => {
      void panelManager.runRevertPrompt();
    }),
    vscode.commands.registerCommand('gitCheckout.bisect.start', () => {
      void panelManager.runBisectStart();
    }),
    vscode.commands.registerCommand('gitCheckout.bisect.good', (arg?: unknown) => {
      void panelManager.runBisectMark('good', bisectCommitSha(arg));
    }),
    vscode.commands.registerCommand('gitCheckout.bisect.bad', (arg?: unknown) => {
      void panelManager.runBisectMark('bad', bisectCommitSha(arg));
    }),
    vscode.commands.registerCommand('gitCheckout.bisect.skip', (arg?: unknown) => {
      void panelManager.runBisectMark('skip', bisectCommitSha(arg));
    }),
    vscode.commands.registerCommand('gitCheckout.bisect.reset', () => {
      void panelManager.runBisectReset();
    }),
    vscode.commands.registerCommand('gitCheckout.applyPatchFromClipboard', () => {
      void panelManager.runApplyPatchFromClipboard();
    }),
    vscode.commands.registerCommand('gitCheckout.undo', () => panelManager.runUndo()),
    vscode.commands.registerCommand('gitCheckout.createPatch', (options?: { revision?: string; saveTo?: string }) =>
      panelManager.runCreatePatch(options),
    ),
    vscode.commands.registerCommand('gitCheckout.applyPatch', () => panelManager.runApplyPatch()),
    vscode.commands.registerCommand('gitCheckout.compare.copyPatch', () => {
      void panelManager.runCompareCopyPatch();
    }),
    vscode.commands.registerCommand('gitCheckout.compare.savePatch', () => {
      void panelManager.runCompareSavePatch();
    }),
    vscode.commands.registerCommand('gitCheckout.searchCommits', (query?: string) =>
      panelManager.searchCommits(typeof query === 'string' ? query : undefined),
    ),
    vscode.commands.registerCommand('gitCheckout.searchNext', () => panelManager.graphShortcut('findNext')),
    vscode.commands.registerCommand('gitCheckout.searchPrevious', () => panelManager.graphShortcut('findPrevious')),
    vscode.commands.registerCommand('gitCheckout.graph.copy', () => panelManager.graphShortcut('copy')),
    vscode.commands.registerCommand('gitCheckout.graph.remove', () => panelManager.graphShortcut('remove')),
    vscode.commands.registerCommand('gitCheckout.graph.showActiveBranchOnly', () => panelManager.graph.setActiveBranchOnly(true)),
    vscode.commands.registerCommand('gitCheckout.graph.showAllBranches', () => panelManager.graph.setActiveBranchOnly(false)),
    vscode.commands.registerCommand('gitCheckout.graph.toggleActiveBranchOnly', () =>
      panelManager.toggleActiveBranchOnly(),
    ),
    vscode.commands.registerCommand('gitCheckout.changes.commit', () => panelManager.changesShortcut('commit')),
    vscode.commands.registerCommand('gitCheckout.changes.commitAndPush', () =>
      panelManager.changesShortcut('commitAndPush'),
    ),
    vscode.commands.registerCommand('gitCheckout.changes.focusCommit', () =>
      panelManager.changesShortcut('focusCommit'),
    ),
    vscode.commands.registerCommand('gitCheckout.clone', (arg?: unknown) => panelManager.runClone(arg)),
    vscode.commands.registerCommand('gitCheckout.quickFetch', () => panelManager.runQuickSync('fetch')),
    vscode.commands.registerCommand('gitCheckout.quickPull', () => panelManager.runQuickSync('pull')),
    vscode.commands.registerCommand('gitCheckout.quickPush', () => panelManager.runQuickSync('push')),
    vscode.commands.registerCommand('gitCheckout.quickStash', () =>
      panelManager.runCreateStash({ message: '', includeNewFiles: false }),
    ),
    ...platformCommandIds('gitCheckout.revealRepository').map((commandId) =>
      vscode.commands.registerCommand(commandId, () => panelManager.revealRepository()),
    ),
    vscode.commands.registerCommand('gitCheckout.graph.collapseMerges', () => {
      void panelManager.collapseMerges();
    }),
    vscode.commands.registerCommand('gitCheckout.graph.showAllMerges', () => {
      void panelManager.showAllMerges();
    }),
    vscode.commands.registerCommand('gitCheckout.graph.showReflog', () => {
      void panelManager.showReflogCommits();
    }),
    vscode.commands.registerCommand('gitCheckout.graph.hideReflog', () => {
      void panelManager.hideReflogCommits();
    }),
    vscode.commands.registerCommand('gitCheckout.diff.previousChange', () => {
      panelManager.navigateCommitDiff('previous');
    }),
    vscode.commands.registerCommand('gitCheckout.diff.nextChange', () => {
      panelManager.navigateCommitDiff('next');
    }),
    vscode.commands.registerCommand('gitCheckout.diff.swapSides', () => {
      panelManager.swapCommitDiffSides();
    }),
    vscode.commands.registerCommand('gitCheckout.diff.toggleIgnoreWhitespace', () => {
      panelManager.toggleCommitDiffIgnoreWhitespace();
    }),
    vscode.commands.registerCommand('gitCheckout.diff.toggleInvisibles', () => {
      panelManager.toggleCommitDiffInvisibles();
    }),
    vscode.commands.registerCommand('gitCheckout.diff.toggleWrap', () => {
      panelManager.toggleCommitDiffWrap();
    }),
    vscode.commands.registerCommand('gitCheckout.diff.moreContext', () => {
      panelManager.changeCommitDiffContext(1);
    }),
    vscode.commands.registerCommand('gitCheckout.diff.lessContext', () => {
      panelManager.changeCommitDiffContext(-1);
    }),
    vscode.commands.registerCommand('gitCheckout.diff.toggleFullFile', () => {
      panelManager.toggleCommitDiffFullFile();
    }),
    vscode.commands.registerCommand('gitCheckout.diff.toggleSideBySide', () => {
      panelManager.toggleCommitDiffSideBySide();
    }),
    vscode.commands.registerCommand('gitCheckout.diff.fileTree', () => {
      panelManager.setCommitFileListMode('tree');
    }),
    ...(
      [
        ['open', 'open'],
        ['openDiff', 'openDiff'],
        ['externalDiff', 'externalDiff'],
        ['showInFinder', 'showInFinder'],
        ['resetToCommit', 'resetToCommit'],
        ['resetToBeforeCommit', 'resetToBeforeCommit'],
        ['saveAs', 'saveAs'],
        ['copyPath', 'copyPath'],
      ] as const
    ).flatMap(([id, action]) =>
      // The reveal command is named differently on each system, so it has one id for each.
      platformCommandIds(`gitCheckout.file.${id}`)
        .filter((commandId) => commandId === `gitCheckout.file.${id}` || id === 'showInFinder')
        .map((commandId) =>
          vscode.commands.registerCommand(commandId, (arg?: unknown, selected?: unknown) =>
            panelManager.runCommitFileAction(action, arg, selected),
          ),
        ),
    ),
    ...(['stage', 'unstage', 'discard', 'open', 'reveal', 'copyPath', 'history', 'blame', 'externalDiff'] as const).flatMap((kind) =>
      platformCommandIds(`gitCheckout.changes.${kind}`)
        .filter((commandId) => commandId === `gitCheckout.changes.${kind}` || kind === 'reveal')
        .map((commandId) =>
          vscode.commands.registerCommand(commandId, (arg?: unknown, selected?: unknown) =>
            panelManager.runChangesFileCommand(kind, arg, selected),
          ),
        ),
    ),
    ...(['incoming', 'current'] as const).map((side) =>
      vscode.commands.registerCommand(`gitCheckout.changes.resolve.${side}`, (arg?: unknown, selected?: unknown) =>
        panelManager.resolveConflictsWith(side, arg, selected),
      ),
    ),
    ...(['tree', 'list'] as const).map((mode) =>
      vscode.commands.registerCommand(`gitCheckout.changes.viewAs.${mode}`, () =>
        panelManager.updateChangesView({ mode }),
      ),
    ),
    vscode.commands.registerCommand('gitCheckout.changes.stageAll', () => panelManager.stageAllChanges()),
    vscode.commands.registerCommand('gitCheckout.changes.unstageAll', () => panelManager.unstageAllChanges()),
    vscode.commands.registerCommand('gitCheckout.changes.toggleHideUntracked', () =>
      panelManager.toggleChangesHideUntracked(),
    ),
    vscode.commands.registerCommand('gitCheckout.changes.toggleShowIgnored', () =>
      panelManager.toggleChangesShowIgnored(),
    ),
    vscode.commands.registerCommand('gitCheckout.file.history', (arg?: unknown) =>
      vscode.commands.executeCommand('gitCheckout.pathHistory.file', arg),
    ),
    vscode.commands.registerCommand('gitCheckout.file.blame', (arg?: unknown) =>
      vscode.commands.executeCommand('gitCheckout.blame.file', arg),
    ),
    vscode.commands.registerCommand('gitCheckout.diff.fileFlat', () => {
      panelManager.setCommitFileListMode('flat');
    }),
    vscode.commands.registerCommand('gitCheckout.workingCopy.showSubmoduleDiff', (arg?: unknown) => {
      if (!isWorkingCopySubmoduleContext(arg)) {
        return;
      }
      panelManager.showSubmoduleDiff(arg.path, arg.side);
    }),
    vscode.commands.registerCommand('gitCheckout.pruneRemote', () => panelManager.housekeeping.runPruneRemote()),
    vscode.commands.registerCommand('gitCheckout.deleteMergedBranches', () => panelManager.housekeeping.runDeleteMergedBranches()),
    vscode.commands.registerCommand('gitCheckout.cleanUntracked', () => panelManager.housekeeping.runCleanUntracked()),
    vscode.commands.registerCommand('gitCheckout.sparseCheckout', () => panelManager.housekeeping.runSparseCheckout()),
    vscode.commands.registerCommand('gitCheckout.statistics', () => panelManager.housekeeping.runStatistics()),
    vscode.commands.registerCommand('gitCheckout.repoSettings', () => panelManager.repoSettings.open()),
    vscode.commands.registerCommand('gitCheckout.gc', () => panelManager.housekeeping.runGc()),
    vscode.commands.registerCommand('gitCheckout.pathHistory.file', (arg?: unknown) => {
      void panelManager.pathHistoryPanel().showFile(arg);
    }),
    vscode.commands.registerCommand('gitCheckout.pathHistory.directory', (arg?: unknown) => {
      void panelManager.pathHistoryPanel().showDirectory(arg);
    }),
    vscode.commands.registerCommand('gitCheckout.pathHistory.hunk', (arg?: unknown) => {
      void panelManager.pathHistoryPanel().showHunk(arg);
    }),
    vscode.commands.registerCommand('gitCheckout.blame.file', (arg?: unknown) => {
      void panelManager.pathHistoryPanel().showBlame(arg);
    }),
    ...Object.keys(GRAPH_CONTEXT_COMMANDS).map((id) =>
      vscode.commands.registerCommand(id, (context: GraphCommitContext) =>
        panelManager.runGraphContextCommand(id, context),
      ),
    ),
  );

  return {
    sidebar: sidebars[0],
    sidebars,
    activityBadge: () => sidebarBadge(),
    sendPanelMessage: (message) => panelManager.sendPanelMessage(message),
    selectRepository: (repoRoot) => panelManager.selectRepository(repoRoot),
    operationFormState: () => panelManager.operationFormState(),
    mergeOpenPath: () => panelManager.mergeOpenPath(),
    lineBlame: () => lineBlame.currentLine(),
    fileBlame: () => fileBlame.columnText(),
    operationBanner: () => panelManager.operationBanner(),
    panelState: () => panelManager.panelState(),
    graphCommits: () => panelManager.graphCommits(),
    autoFetchNow: () => autoFetch.tick(true),
    changesLists: { unstaged: windows.lists.unstaged.provider, staged: windows.lists.staged.provider },
    revisionLists: { commitFiles: windows.lists.commitFiles.provider, tree: windows.lists.tree.provider },
    commitFiles: () => panelManager.commitFilesSnapshot(),
  };
}

export function deactivate(): void {
  setGitExtensionService(undefined);
}
