import { REVEAL_COMMAND_BASES, platformCommandIds } from '../shared/app/platformCommands';
import { basename } from 'node:path';
import { Debouncer } from '../core/debounce';
import { Activity, whenActive } from '../core/whenActive';
import { windowFocus } from '../panel/windowFocus';
import { sameWorktreePath } from '../features/worktrees/worktreeParser';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { changeCountBadge, parseCountBadgeMode } from './changeCountBadge';
import { parseAddRemoteArg } from '../features/sync/addRemote';
import { parseBranchCreateArg } from '../features/branches/branchCreate';
import { parseBranchRenameArg } from '../features/branches/branchRename';
import type { GitExtensionService } from '../core/gitExtensionService';
import type { GitWatchService } from '../core/gitWatchService';
import { createLogger } from '../log';
import type { RefsMutateOp } from '../shared/branches/refsProtocol';
import type { GitCheckoutPanelManager } from '../panel/gitCheckoutPanelManager';
import {
    assignRepoRoot,
    buildSidebarTree,
    dropIntent,
    pickCompareBranches,
    pickStashSelectors,
    pickSubmodulePaths,
    repositoryNode,
    REPOSITORIES_VIEW_ID,
    sectionRows,
    SIDEBAR_COMMANDS,
    SIDEBAR_CONTEXT,
    SIDEBAR_DRAG_MIME,
    PULL_REQUESTS_VIEW_ID,
    SIDEBAR_VIEW_ID,
    sectionsViewRows,
    sidebarMessageNode,
    treeItemSpec,
    withSidebarSearch,
    type SidebarCollapsible,
    type SidebarNode,
} from './sidebarTreeModel';
import { registerRepositoryMenuCommands } from './repositoryMenuCommands';
import { pullRequestSection } from './pullRequestNodes';
import { checksUri, registerChecksDecorations } from './pullRequestChecksDecoration';
import type { PullRequestStore } from '../features/pullRequests/PullRequestStore';

const log = createLogger('sidebar');

const COLLAPSIBLE: Record<SidebarCollapsible, vscode.TreeItemCollapsibleState> = {
  none: vscode.TreeItemCollapsibleState.None,
  collapsed: vscode.TreeItemCollapsibleState.Collapsed,
  expanded: vscode.TreeItemCollapsibleState.Expanded,
};

/** What the section views of the selected repository read: one build of its tree, until something changes. */
class SidebarSource {
  private tree: Promise<{ root: string; nodes: SidebarNode[] } | undefined> | undefined;

  constructor(
    private readonly panel: GitCheckoutPanelManager,
    private readonly search: { query: string },
    private readonly pullRequests?: PullRequestStore,
  ) {}

  invalidate(): void {
    this.tree = undefined;
  }

  read(): Promise<{ root: string; nodes: SidebarNode[] } | undefined> {
    this.tree ??= this.build();
    return this.tree;
  }

  private async build(): Promise<{ root: string; nodes: SidebarNode[] } | undefined> {
    const root = this.panel.activeRepoRoot();
    if (!root) {
      return undefined;
    }
    try {
      const data = await this.panel.loadSidebarData(root);
      if (!data) {
        return undefined;
      }
      const pullRequests = this.pullRequests && pullRequestSection(this.pullRequests.peek(root));
      const sections = buildSidebarTree(data.snapshot, data.stashes, data.worktrees, data.submodules, pullRequests);
      const nodes = withSidebarSearch(sections, this.search.query);
      for (const node of nodes) {
        assignRepoRoot(node, root);
      }
      return { root, nodes };
    } catch (error) {
      log.error('loading refs failed', error);
      const message = error instanceof Error ? error.message : String(error);
      const failed = sidebarMessageNode(l10n.t('Could not load refs: {0}', message));
      assignRepoRoot(failed, root);
      return { root, nodes: [failed] };
    }
  }
}

/** Which rows of the selected repository's tree a view lists: all of them, every section but Pull Requests, or one section's. */
type SidebarScope = { kind: 'all' } | { kind: 'sections' } | { kind: 'section'; id: string };

class SidebarProvider
  implements vscode.TreeDataProvider<SidebarNode>, vscode.TreeDragAndDropController<SidebarNode>
{
  readonly dragMimeTypes = [SIDEBAR_DRAG_MIME];
  readonly dropMimeTypes = [SIDEBAR_DRAG_MIME];
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(
    private readonly panel: GitCheckoutPanelManager,
    private readonly source: SidebarSource,
    private readonly scope: SidebarScope,
  ) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }

  getTreeItem(node: SidebarNode): vscode.TreeItem {
    return sidebarTreeItem(node);
  }

  async getChildren(node?: SidebarNode): Promise<SidebarNode[]> {
    if (node) {
      return node.children;
    }
    const tree = await this.source.read();
    if (!tree) {
      return [];
    }
    switch (this.scope.kind) {
      case 'all':
        return tree.nodes;
      case 'sections':
        return sectionsViewRows(tree.nodes);
      case 'section':
        return sectionRows(tree.nodes, this.scope.id);
    }
  }

  handleDrag(sources: readonly SidebarNode[], dataTransfer: vscode.DataTransfer): void {
    dataTransfer.set(SIDEBAR_DRAG_MIME, new vscode.DataTransferItem(sources));
  }

  async handleDrop(target: SidebarNode | undefined, dataTransfer: vscode.DataTransfer): Promise<void> {
    const sources = dataTransfer.get(SIDEBAR_DRAG_MIME)?.value as SidebarNode[] | undefined;
    const intent = dropIntent(sources ?? [], target);
    if (intent) {
      if (target?.repoRoot) {
        await this.panel.selectRepository(target.repoRoot);
      }
      await this.panel.runBranchDrop(intent.source, intent.target);
    }
  }
}

function sidebarTreeItem(node: SidebarNode): vscode.TreeItem {
  const spec = treeItemSpec(node);
  const item = new vscode.TreeItem(spec.label, COLLAPSIBLE[spec.collapsible]);
  // Every repository repeats the same row ids, so scope them to the repository.
  item.id = node.repoRoot ? `${node.repoRoot}::${node.id}` : node.id;
  item.description = spec.description;
  item.tooltip = spec.tooltip;
  item.contextValue = spec.contextValue;
  if (spec.icon) {
    item.iconPath = spec.iconColor
      ? new vscode.ThemeIcon(spec.icon, new vscode.ThemeColor(spec.iconColor))
      : new vscode.ThemeIcon(spec.icon);
  }
  if (spec.checks) {
    item.resourceUri = checksUri(item.id, spec.checks);
  }
  if (spec.command) {
    item.command = { command: spec.command.id, title: spec.label, arguments: spec.command.args };
  }
  return item;
}

/** The Repositories view: every repository, with its branch; the one picked is the one the other views show. */
class RepositoriesProvider implements vscode.TreeDataProvider<SidebarNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  /** One row for each repository, kept until something in that repository changes. */
  private readonly rows = new Map<string, Promise<SidebarNode>>();

  constructor(private readonly panel: GitCheckoutPanelManager) {}

  /** Reads one repository's row again, or every row, and tells the view. */
  refresh(root?: string): void {
    if (root === undefined || !this.rows.has(root)) {
      this.rows.clear();
    } else {
      this.rows.delete(root);
    }
    this._onDidChangeTreeData.fire();
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }

  getTreeItem(node: SidebarNode): vscode.TreeItem {
    return sidebarTreeItem(node);
  }

  getParent(): undefined {
    return undefined;
  }

  getChildren(node?: SidebarNode): Promise<SidebarNode[]> {
    if (node) {
      return Promise.resolve([]);
    }
    return Promise.all(this.panel.repositoryRoots().map((root) => this.row(root)));
  }

  /** The row of a repository, for selecting it in the view. */
  async rowFor(root: string): Promise<SidebarNode | undefined> {
    return (await this.getChildren()).find((node) => node.repoRoot === root);
  }

  private row(root: string): Promise<SidebarNode> {
    let row = this.rows.get(root);
    if (!row) {
      row = this.panel.loadRepositorySummary(root).then(
        (summary) => repositoryNode(root, basename(root), summary.branch && `refs/heads/${summary.branch}`, summary.upstreamTrack, summary.changedCount),
        (error: unknown) => {
          log.warn(`could not read ${root}`, error);
          return repositoryNode(root, basename(root), null, null, 0);
        },
      );
      this.rows.set(root, row);
    }
    return row;
  }
}

export function registerGitCheckoutSidebar(
  context: vscode.ExtensionContext,
  panel: GitCheckoutPanelManager,
  gitService: GitExtensionService,
  watchService: GitWatchService,
  pullRequests?: PullRequestStore,
): { providers: vscode.TreeDataProvider<SidebarNode>[]; repositories: vscode.TreeDataProvider<SidebarNode>; badge(): number | undefined; pullRequestsOnScreen(): boolean } {
  const search = { query: '' };
  const source = new SidebarSource(panel, search, pullRequests);
  // The sections of the repository in one view, and the pull requests in another.
  const scoped = [
    { view: SIDEBAR_VIEW_ID, scope: { kind: 'sections' } as SidebarScope },
    { view: PULL_REQUESTS_VIEW_ID, scope: { kind: 'section', id: 'section:pullRequests' } as SidebarScope },
  ].map((entry) => ({ ...entry, provider: new SidebarProvider(panel, source, entry.scope) }));
  // The whole tree in one provider, which the tests read; no view shows it.
  const everything = new SidebarProvider(panel, source, { kind: 'all' });
  const repositories = new RepositoriesProvider(panel);
  const repositoriesView = vscode.window.createTreeView(REPOSITORIES_VIEW_ID, { treeDataProvider: repositories });
  /** True while the view's selection is being set by us rather than by a click. */
  let highlighting = false;
  /** The Pull Requests view is there only while the repository is on GitHub and the setting is on; this does not read the list. */
  const updatePullRequestsAvailable = (): void => {
    const root = panel.activeRepoRoot();
    const available = Boolean(pullRequests && root && pullRequests.peek(root).kind !== 'hidden');
    void vscode.commands.executeCommand('setContext', 'gitCheckout.pullRequestsAvailable', available);
  };
  const refreshAll = (): void => {
    updatePullRequestsAvailable();
    source.invalidate();
    repositories.refresh();
    scoped.forEach((entry) => entry.provider.refresh());
    everything.refresh();
    if (repositoriesView.visible) {
      void showActive();
    }
    updateBadge();
  };
  /** Highlights the selected repository in the Repositories view. */
  async function showActive(): Promise<void> {
    const root = panel.activeRepoRoot();
    const row = root ? await repositories.rowFor(root) : undefined;
    // The choice may have moved on while the rows loaded; never select a row that is not the active one anymore.
    if (!row || panel.activeRepoRoot() !== row.repoRoot || repositoriesView.selection[0]?.repoRoot === row.repoRoot) {
      return;
    }
    highlighting = true;
    try {
      await repositoriesView.reveal(row, { select: true, focus: false });
    } catch (error) {
      // The view is not shown yet, so there is nothing to highlight; it highlights the row when it is.
      log.debug('could not select the repository row', error);
    } finally {
      // The selection event of our own highlight comes after the call returns.
      setTimeout(() => { highlighting = false; }, 100);
    }
  }
  // Events come in bursts: a file change, the command that made it, the watcher's own report. One refresh covers them,
  // and a change in another repository only reads that repository's row again.
  const refreshLater = new Debouncer(150);
  let everythingChanged = false;
  const changedElsewhere = new Set<string>();
  const flush = (): void => {
    const rows = [...changedElsewhere];
    changedElsewhere.clear();
    if (everythingChanged) {
      everythingChanged = false;
      refreshAll();
      return;
    }
    rows.forEach((row) => repositories.refresh(row));
  };
  // A window in the background reads nothing; what changed meanwhile is read once when it comes back.
  const flushInFront = whenActive(flush, () => windowFocus.active, windowFocus.onDidBecomeActive);
  const refreshSoon = (root?: string): void => {
    const active = panel.activeRepoRoot();
    if (root === undefined || !active || sameWorktreePath(root, active)) {
      everythingChanged = true;
    } else {
      changedElsewhere.add(root);
    }
    refreshLater.schedule(() => flushInFront.request());
  };
  const setSearchQuery = (query: string): void => {
    search.query = query.trim();
    void vscode.commands.executeCommand('setContext', 'gitCheckout.sidebarSearching', search.query.length > 0);
    refreshAll();
  };
  registerRepositoryMenuCommands(context, panel);
  const views = scoped.map((entry) =>
    vscode.window.createTreeView(entry.view, {
      treeDataProvider: entry.provider,
      dragAndDropController: entry.provider,
      canSelectMany: true,
    }),
  );
  // GitHub is asked for the pull requests only while their view is on screen.
  const pullRequestsView = views[scoped.findIndex((entry) => entry.view === PULL_REQUESTS_VIEW_ID)];
  const pullRequestsActivity = new Activity(() => windowFocus.active && pullRequestsView.visible);
  pullRequests?.watch(pullRequestsActivity);
  updatePullRequestsAvailable();
  context.subscriptions.push(
    pullRequestsView.onDidChangeVisibility(() => pullRequestsActivity.changed()),
    windowFocus.onDidBecomeActive(() => pullRequestsActivity.changed()),
    repositories,
    repositoriesView,
    everything,
    ...scoped.map((entry) => entry.provider),
    ...views,
    // Picking a repository makes it the one the graph and every view show.
    repositoriesView.onDidChangeSelection((event) => {
      const root = event.selection[0]?.repoRoot;
      if (root && !highlighting) {
        void panel.selectRepository(root);
      }
    }),
    repositoriesView.onDidChangeVisibility((event) => {
      if (event.visible) {
        void showActive();
      }
    }),
    registerChecksDecorations(),
    panel.onDidChangeActiveRepo(refreshAll),
  );
  // The number on the Git Checkout icon, like the Source Control icon's. Activity Bar icons show one badge
  // for their whole container, so the first view carries the total. It reads VS Code's Git state: no git call.
  function updateBadge(): void {
    const roots = new Set(panel.repositoryRoots());
    const count = changeCountBadge(
      gitService.getRepositories()
        .filter((repo) => roots.has(repo.rootUri.fsPath))
        .map((repo) => ({ root: repo.rootUri.fsPath, state: repo.state })),
      parseCountBadgeMode(vscode.workspace.getConfiguration('scm').get('countBadge')),
      panel.activeRepoRoot(),
    );
    repositoriesView.badge = count > 0
      ? { value: count, tooltip: count === 1 ? l10n.t('1 pending change') : l10n.t('{0} pending changes', count) }
      : undefined;
  }
  updateBadge();
  context.subscriptions.push(
    { dispose: () => refreshLater.dispose() },
    flushInFront,
    gitService.onDidChangeDiagnostics(() => refreshSoon()),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('scm.countBadge')) { updateBadge(); }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => refreshSoon()),
    watchService.onDidRefresh((event) => refreshSoon(event.repoRoot)),
    // A pull request list changing is a single event, not a burst, so it shows at once.
    ...(pullRequests ? [pullRequests.onDidChange(refreshAll)] : []),
    panel.onDidChangeRefs(() => refreshSoon()),
  );

  const withRef =
    (run: (ref: string) => unknown) =>
    (node?: SidebarNode): unknown =>
      node?.ref ? run(node.ref) : undefined;
  const mutate = (op: RefsMutateOp) => panel.runRefsMutate(op);

  const handlers: Record<
    (typeof SIDEBAR_COMMANDS)[keyof typeof SIDEBAR_COMMANDS],
    (node?: SidebarNode, selected?: SidebarNode[]) => unknown
  > = {
    [SIDEBAR_COMMANDS.revealInGraph]: withRef((ref) => panel.revealRefInGraph(ref)),
    [SIDEBAR_COMMANDS.showLocalChanges]: () => panel.showLocalChanges(),
    [SIDEBAR_COMMANDS.showAllCommits]: () => panel.showAllCommits(),
    [SIDEBAR_COMMANDS.search]: (arg?: SidebarNode | string) => promptSidebarSearch(search.query, setSearchQuery, arg),
    [SIDEBAR_COMMANDS.clearSearch]: () => {
      setSearchQuery('');
    },
    [SIDEBAR_COMMANDS.checkout]: (node) =>
      node?.ref ? panel.runCheckout(node.ref, node.kind === 'branch') : undefined,
    [SIDEBAR_COMMANDS.checkoutTag]: withRef((ref) => panel.runCheckout(ref, false)),
    [SIDEBAR_COMMANDS.checkoutAsWorktree]: (node) =>
      node?.ref ? panel.runCheckoutAsWorktree(node.ref) : undefined,
    [SIDEBAR_COMMANDS.fastForward]: withRef((ref) => panel.runFastForward(ref)),
    [SIDEBAR_COMMANDS.pullBranch]: (node) => node?.ref ? panel.runPullBranch(node.ref) : undefined,
    [SIDEBAR_COMMANDS.pushBranch]: withRef((ref) => panel.runPushBranch(ref)),
    [SIDEBAR_COMMANDS.openPullRequest]: withRef((ref) => panel.runOpenPullRequest(ref)),
    [SIDEBAR_COMMANDS.openPullRequestWithAi]: withRef((ref) => panel.runOpenPullRequest(ref, true)),
    [SIDEBAR_COMMANDS.fetchRemote]: withRef((remote) => panel.runFetch(undefined, remote)),
    [SIDEBAR_COMMANDS.merge]: withRef((ref) => panel.runMergeRef(ref)),
    [SIDEBAR_COMMANDS.rebase]: withRef((ref) => panel.runRebaseRef(ref)),
    [SIDEBAR_COMMANDS.interactiveRebaseTag]: withRef((ref) => panel.runInteractiveRebase(ref)),
    [SIDEBAR_COMMANDS.showTagDetails]: withRef((ref) => panel.runShowTagDetails(ref)),
    [SIDEBAR_COMMANDS.pushTag]: withRef((ref) => panel.runPushTag(ref)),
    [SIDEBAR_COMMANDS.setUpstream]: withRef((name) => mutate({ op: 'branchSetUpstream', name })),
    [SIDEBAR_COMMANDS.unsetUpstream]: withRef((name) => mutate({ op: 'branchUnsetUpstream', name })),
    [SIDEBAR_COMMANDS.renameBranch]: (node?: SidebarNode) => {
      const parsed = parseBranchRenameArg(node);
      if (parsed.status === 'invalid') {
        void vscode.window.showWarningMessage(parsed.message);
        return undefined;
      }
      if (!parsed.oldName) {
        return undefined;
      }
      return mutate({
        op: 'branchRename',
        name: parsed.oldName,
        request: parsed.status === 'ready' ? parsed.request : undefined,
      });
    },
    [SIDEBAR_COMMANDS.deleteBranch]: (node) => {
      if (!node?.ref) { return undefined; }
      return mutate(node.kind === 'remoteBranch'
        ? { op: 'remoteBranchDelete', name: node.ref }
        : { op: 'branchDelete', name: node.ref });
    },
    [SIDEBAR_COMMANDS.createBranch]: (arg?: SidebarNode) => {
      const parsed = parseBranchCreateArg(arg);
      if (parsed.status === 'invalid') {
        void vscode.window.showWarningMessage(parsed.message);
        return undefined;
      }
      const startRef =
        arg && (arg.kind === 'branch' || arg.kind === 'remoteBranch' || arg.kind === 'tag') && arg.ref
          ? arg.ref
          : undefined;
      return mutate({
        op: 'branchCreate',
        startRef,
        request: parsed.status === 'ready' ? parsed.request : undefined,
      });
    },
    [SIDEBAR_COMMANDS.compareBranches]: (node, selected) => {
      const pair = pickCompareBranches(node, selected);
      if (!pair) {
        void vscode.window.showWarningMessage(l10n.t('Select exactly two local branches to compare.'));
        return undefined;
      }
      return panel.runRefsCompare(pair[0], pair[1]);
    },
    [SIDEBAR_COMMANDS.copyBranchName]: (node) =>
      node?.ref ? panel.runCopyBranchName(node.ref) : undefined,
    [SIDEBAR_COMMANDS.copyTagName]: (node) =>
      node?.ref ? panel.runCopyBranchName(node.ref) : undefined,
    [SIDEBAR_COMMANDS.createTag]: (arg?: SidebarNode) => {
      const objectRef =
        arg && (arg.kind === 'branch' || arg.kind === 'remoteBranch' || arg.kind === 'tag')
          ? arg.ref
          : undefined;
      return mutate({ op: 'tagCreateAnnotated', objectRef });
    },
    [SIDEBAR_COMMANDS.createTagLight]: (arg?: SidebarNode) => {
      const objectRef =
        arg && (arg.kind === 'branch' || arg.kind === 'remoteBranch' || arg.kind === 'tag')
          ? arg.ref
          : undefined;
      return mutate({ op: 'tagCreateLight', objectRef });
    },
    [SIDEBAR_COMMANDS.createTagAnnotated]: (arg?: SidebarNode) => {
      const objectRef =
        arg && (arg.kind === 'branch' || arg.kind === 'remoteBranch' || arg.kind === 'tag')
          ? arg.ref
          : undefined;
      return mutate({ op: 'tagCreateAnnotated', objectRef });
    },
    [SIDEBAR_COMMANDS.deleteTag]: withRef((name) => mutate({ op: 'tagDelete', name })),
    [SIDEBAR_COMMANDS.addRemote]: (arg?: unknown) => {
      const parsed = parseAddRemoteArg(arg);
      if (parsed.status === 'invalid') {
        void vscode.window.showWarningMessage(parsed.message);
        return undefined;
      }
      return mutate({
        op: 'remoteAdd',
        request: parsed.status === 'ready' ? parsed.request : undefined,
      });
    },
    [SIDEBAR_COMMANDS.removeRemote]: withRef((name) => mutate({ op: 'remoteRemove', name })),
    [SIDEBAR_COMMANDS.openRemote]: withRef((name) => panel.runOpenRemote(name)),
    [SIDEBAR_COMMANDS.editRemote]: withRef((name) => mutate({ op: 'remoteEdit', name })),
    [SIDEBAR_COMMANDS.createStash]: (arg?: unknown) => panel.runCreateStash(arg),
    [SIDEBAR_COMMANDS.clearStashes]: () => panel.runClearStashes(),
    [SIDEBAR_COMMANDS.applyStash]: (node) => (node?.ref ? panel.runApplyStash(node.ref) : undefined),
    [SIDEBAR_COMMANDS.popStash]: (node) => (node?.ref ? panel.runPopStash(node.ref) : undefined),
    [SIDEBAR_COMMANDS.dropStash]: (node, selected) => {
      const selectors = pickStashSelectors(node, selected);
      return selectors.length > 0 ? panel.runDropStashes(selectors) : undefined;
    },
    [SIDEBAR_COMMANDS.showStash]: (node) => (node?.ref ? panel.runShowStash(node.ref) : undefined),
    [SIDEBAR_COMMANDS.renameStash]: (node) => (node?.ref ? panel.runRenameStash(node.ref) : undefined),
    [SIDEBAR_COMMANDS.saveStashPatch]: (node) => (node?.ref ? panel.runSaveStashPatch(node.ref) : undefined),
    [SIDEBAR_COMMANDS.createWorktree]: (arg?: unknown) => panel.runCreateWorktree(arg),
    [SIDEBAR_COMMANDS.openWorktree]: (node) =>
      node?.ref ? panel.runOpenWorktree(node.ref) : undefined,
    [SIDEBAR_COMMANDS.copyWorktreePath]: (node) =>
      node?.ref ? panel.runCopyWorktreePath(node.ref) : undefined,
    [SIDEBAR_COMMANDS.revealWorktree]: (node) =>
      node?.ref ? panel.runRevealWorktree(node.ref) : undefined,
    [SIDEBAR_COMMANDS.deleteWorktree]: (node) =>
      node?.ref ? panel.runDeleteWorktree(node.ref) : undefined,
    [SIDEBAR_COMMANDS.addSubmodule]: () => panel.runAddSubmodule(),
    [SIDEBAR_COMMANDS.initSubmodules]: () => panel.runInitSubmodules(),
    [SIDEBAR_COMMANDS.updateSubmodules]: () => panel.runUpdateSubmodules(),
    [SIDEBAR_COMMANDS.syncSubmodules]: () => panel.runSyncSubmodules(),
    [SIDEBAR_COMMANDS.initSubmodule]: (node, selected) => {
      const paths = pickSubmodulePaths(node, selected);
      return paths.length > 0 ? panel.runInitSubmodules(paths) : undefined;
    },
    [SIDEBAR_COMMANDS.updateSubmodule]: (node, selected) => {
      const paths = pickSubmodulePaths(node, selected);
      return paths.length > 0 ? panel.runUpdateSubmodules(paths) : undefined;
    },
    [SIDEBAR_COMMANDS.syncSubmodule]: (node, selected) => {
      const paths = pickSubmodulePaths(node, selected);
      return paths.length > 0 ? panel.runSyncSubmodules(paths) : undefined;
    },
    [SIDEBAR_COMMANDS.openSubmodule]: (node) =>
      node?.ref
        ? panel.runOpenSubmodule(node.ref, node.contextValue === SIDEBAR_CONTEXT.submoduleUninitialized)
        : undefined,
    [SIDEBAR_COMMANDS.copySubmodulePath]: (node) =>
      node?.ref ? panel.runCopySubmodulePath(node.ref) : undefined,
    [SIDEBAR_COMMANDS.openSubmoduleInTerminal]: (node) =>
      node?.ref ? panel.runOpenSubmoduleInTerminal(node.ref) : undefined,
    [SIDEBAR_COMMANDS.revealSubmodule]: (node) =>
      node?.ref ? panel.runRevealSubmodule(node.ref) : undefined,
    [SIDEBAR_COMMANDS.deleteSubmodule]: (node) =>
      node?.ref ? panel.runDeleteSubmodule(node.ref) : undefined,
    [SIDEBAR_COMMANDS.showSubmoduleDiff]: (node) =>
      node?.ref ? panel.showSubmoduleDiff(node.ref, 'unstaged') : undefined,
  };

  // Actions run on the active repository, so a row from another repository selects it first.
  for (const [id, handler] of Object.entries(handlers)) {
    const run = (node?: SidebarNode, selected?: SidebarNode[]): unknown => {
      const repoRoot = node?.repoRoot;
      return repoRoot
        ? panel.selectRepository(repoRoot).then(() => handler(node, selected))
        : handler(node, selected);
    };
    // Reveal in the file manager has one id per system, all doing the same thing.
    const ids = (REVEAL_COMMAND_BASES as readonly string[]).includes(id) ? platformCommandIds(id) : [id];
    for (const commandId of ids) {
      context.subscriptions.push(vscode.commands.registerCommand(commandId, run));
    }
  }
  return { providers: [everything], repositories, badge: () => repositoriesView.badge?.value, pullRequestsOnScreen: () => pullRequestsView.visible };
}

async function promptSidebarSearch(
  current: string,
  setQuery: (query: string) => void,
  arg: unknown,
): Promise<void> {
  if (typeof arg === 'string') {
    setQuery(arg);
    return;
  }
  const value = await vscode.window.showInputBox({
    title: l10n.t('Search'),
    prompt: l10n.t('Filter branches, tags, stashes, worktrees, remotes, and submodules'),
    value: current,
    placeHolder: l10n.t('Name, path, or message'),
  });
  if (value === undefined) {
    return;
  }
  setQuery(value);
}
