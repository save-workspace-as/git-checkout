import { REVEAL_COMMAND_BASES, platformCommandIds } from '../shared/app/platformCommands';
import { basename } from 'node:path';
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
    repositoryBranchLabel,
    SIDEBAR_COMMANDS,
    SIDEBAR_CONTEXT,
    SIDEBAR_DRAG_MIME,
    SIDEBAR_REPO_SLOTS,
    sidebarViewId,
    sidebarMessageNode,
    treeItemSpec,
    withSidebarSearch,
    type SidebarCollapsible,
    type SidebarNode,
} from './sidebarTreeModel';
import { registerRepositoryMenuCommands } from './repositoryMenuCommands';

const log = createLogger('sidebar');

const COLLAPSIBLE: Record<SidebarCollapsible, vscode.TreeItemCollapsibleState> = {
  none: vscode.TreeItemCollapsibleState.None,
  collapsed: vscode.TreeItemCollapsibleState.Collapsed,
  expanded: vscode.TreeItemCollapsibleState.Expanded,
};

class SidebarProvider
  implements vscode.TreeDataProvider<SidebarNode>, vscode.TreeDragAndDropController<SidebarNode>
{
  readonly dragMimeTypes = [SIDEBAR_DRAG_MIME];
  readonly dropMimeTypes = [SIDEBAR_DRAG_MIME];
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  /** Shows the repository at `slot` of the open repositories; the view is empty without one. */
  constructor(
    private readonly panel: GitCheckoutPanelManager,
    private readonly slot: number,
    private readonly repos: { roots: readonly string[] },
    private readonly search: { query: string },
    private readonly onRepository: (slot: number, root: string | null, headRef: string | null) => void,
  ) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }

  getTreeItem(node: SidebarNode): vscode.TreeItem {
    const spec = treeItemSpec(node);
    const item = new vscode.TreeItem(spec.label, COLLAPSIBLE[spec.collapsible]);
    // Every repository repeats the same section ids, so scope them to the repository.
    item.id = node.repoRoot ? `${node.repoRoot}::${node.id}` : node.id;
    item.description = spec.description;
    item.tooltip = spec.tooltip;
    item.contextValue = spec.contextValue;
    if (spec.icon) {
      item.iconPath = spec.iconColor
        ? new vscode.ThemeIcon(spec.icon, new vscode.ThemeColor(spec.iconColor))
        : new vscode.ThemeIcon(spec.icon);
    }
    if (spec.command) {
      item.command = { command: spec.command.id, title: spec.label, arguments: spec.command.args };
    }
    return item;
  }

  async getChildren(node?: SidebarNode): Promise<SidebarNode[]> {
    if (node) {
      return node.children;
    }
    // Every view reads the same snapshot, so the repositories cannot shift between slots mid-refresh.
    const root = this.repos.roots[this.slot];
    if (!root) {
      this.onRepository(this.slot, null, null);
      return [];
    }
    try {
      const data = await this.panel.loadSidebarData(root);
      if (!data) {
        this.onRepository(this.slot, null, null);
        return [];
      }
      const sections = buildSidebarTree(
        data.snapshot,
        data.worktree,
        data.stashes,
        data.worktrees,
        data.submodules,
      );
      this.onRepository(this.slot, root, data.snapshot.headRef);
      const tree = withSidebarSearch(sections, this.search.query);
      for (const node of tree) {
        assignRepoRoot(node, root);
      }
      return tree;
    } catch (error) {
      log.error('loading refs failed', error);
      const message = error instanceof Error ? error.message : String(error);
      const failed = sidebarMessageNode(l10n.t("Could not load refs: {0}", message));
      assignRepoRoot(failed, root);
      return [failed];
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

export function registerGitCheckoutSidebar(
  context: vscode.ExtensionContext,
  panel: GitCheckoutPanelManager,
  gitService: GitExtensionService,
  watchService: GitWatchService,
): { providers: vscode.TreeDataProvider<SidebarNode>[]; badge(): number | undefined } {
  const search = { query: '' };
  const repos: { roots: readonly string[] } = { roots: panel.repositoryRoots() };
  const views: vscode.TreeView<SidebarNode>[] = [];
  const onRepository = (slot: number, root: string | null, headRef: string | null): void => {
    const view = views[slot];
    if (view) {
      view.title = root ? basename(root) : undefined;
      view.description = root ? repositoryBranchLabel(headRef) : undefined;
    }
  };
  const providers = Array.from(
    { length: SIDEBAR_REPO_SLOTS },
    (_, slot) => new SidebarProvider(panel, slot, repos, search, onRepository),
  );
  const syncRepositoryCount = (): void => {
    const count = Math.min(Math.max(repos.roots.length, 1), SIDEBAR_REPO_SLOTS);
    void vscode.commands.executeCommand('setContext', 'gitCheckout.sidebarRepoCount', count);
  };
  const refreshAll = (): void => {
    repos.roots = panel.repositoryRoots();
    syncRepositoryCount();
    providers.forEach((entry) => entry.refresh());
    updateBadge();
  };
  const setSearchQuery = (query: string): void => {
    search.query = query.trim();
    void vscode.commands.executeCommand('setContext', 'gitCheckout.sidebarSearching', search.query.length > 0);
    refreshAll();
  };
  syncRepositoryCount();
  registerRepositoryMenuCommands(context, panel, repos);
  providers.forEach((entry, slot) => {
    const view = vscode.window.createTreeView(sidebarViewId(slot), {
      treeDataProvider: entry,
      dragAndDropController: entry,
      canSelectMany: true,
    });
    views.push(view);
    context.subscriptions.push(
      entry,
      view,
      // Working in a repository's view makes it the one the graph shows.
      view.onDidChangeSelection(() => {
        const root = repos.roots[slot];
        if (root) {
          void panel.selectRepository(root);
        }
      }),
    );
  });
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
    const view = views[0];
    if (view) {
      view.badge = count > 0
        ? { value: count, tooltip: count === 1 ? l10n.t('1 pending change') : l10n.t('{0} pending changes', count) }
        : undefined;
    }
  }
  updateBadge();
  context.subscriptions.push(
    gitService.onDidChangeDiagnostics(refreshAll),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('scm.countBadge')) { updateBadge(); }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(refreshAll),
    watchService.onDidRefresh(refreshAll),
    panel.onDidChangeRefs(refreshAll),
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
  return { providers, badge: () => views[0]?.badge?.value };
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
