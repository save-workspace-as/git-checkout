import * as vscode from 'vscode';
import { createLogger } from '../log';
import type { GitCliRegistry } from '../core/gitCliRegistry';
import type { GitExtensionService } from '../core/gitExtensionService';
import type { GitWatchService } from '../core/gitWatchService';
import { sameWorktreePath } from '../features/worktrees/worktreeParser';
import { restoreBuiltInScm } from '../ui/scmVisibility';
import {
  COMMIT_FILE_LIST_VIEW_ID,
  STAGED_VIEW_ID,
  TREE_VIEW_ID,
  UNSTAGED_VIEW_ID,
  createBottomViewSlots,
  registerBottomPanelViews,
  type BottomViewSlots,
} from './bottomPanelViews';
import { ChangeDecorations, ChangesList, type PanelLists } from '../features/changes/changesList';
import { RevisionList } from '../features/history/revisionLists';
import { GitCheckoutPanelManager } from './gitCheckoutPanelManager';
import type { PanelWindowHost } from './panelWindowHost';

const log = createLogger('windows');

/**
 * One Git Checkout window per repository, each with its own graph, selection, filters and form
 * state. The bottom views, sidebar and commands are shared and follow the current window: the one
 * last brought to the front, or the repository last picked in the sidebar.
 */
export class GitCheckoutWindows implements PanelWindowHost, vscode.Disposable {
  readonly slots: BottomViewSlots = createBottomViewSlots();
  private readonly decorations = new ChangeDecorations();
  /** A pick in either list is a selection in the current window. */
  private readonly pick = (change: { path: string; side: 'staged' | 'unstaged' }): void => {
    void this.current.handleBottomViewMessage({ type: 'changesSelect', ...change });
  };
  readonly lists: PanelLists = {
    unstaged: new ChangesList(UNSTAGED_VIEW_ID, this.decorations, this.pick),
    staged: new ChangesList(STAGED_VIEW_ID, this.decorations, this.pick),
    // Picking a commit's changed file shows its diff; picking a file of the tree previews it.
    commitFiles: new RevisionList(COMMIT_FILE_LIST_VIEW_ID, this.decorations, vscode.TreeItemCollapsibleState.Expanded, (node) => {
      void this.current.handleBottomViewMessage({
        type: 'commitDetailsSelectFile',
        sha: node.revision ?? '',
        ...(node.baseRevision ? { baseSha: node.baseRevision } : {}),
        path: node.path,
      });
    }),
    tree: new RevisionList(TREE_VIEW_ID, this.decorations, vscode.TreeItemCollapsibleState.Collapsed, (node) => {
      void this.current.handleBottomViewMessage({ type: 'commitTreeOpen', revision: node.revision ?? 'HEAD', path: node.path });
    }),
  };
  private readonly windows: GitCheckoutPanelManager[] = [];
  private current: GitCheckoutPanelManager;
  private readonly refsChanged = new vscode.EventEmitter<void>();
  private readonly disposables: vscode.Disposable[] = [this.refsChanged, this.decorations, ...Object.values(this.lists)];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly gitService: GitExtensionService,
    private readonly watchService: GitWatchService,
    private readonly cliRegistry: GitCliRegistry,
  ) {
    this.current = this.open(null);
    this.disposables.push(
      registerBottomPanelViews(context, this.slots, (message) => {
        void this.current.handleBottomViewMessage(message);
      }),
    );
    this.current.activate();
    this.disposables.push(this.gitService.onDidChangeDiagnostics(() => this.pruneWindowsOfClosedRepositories()));
  }

  private open(repoRoot: string | null): GitCheckoutPanelManager {
    const window = new GitCheckoutPanelManager(
      this.context, this.gitService, this.watchService, this.cliRegistry, this, repoRoot,
    );
    this.windows.push(window);
    this.disposables.push(window.onDidChangeRefs(() => this.refsChanged.fire()));
    return window;
  }

  owns(window: object): boolean {
    return window === this.current;
  }

  focused(window: object): void {
    const next = this.windows.find((candidate) => candidate === window);
    if (next) {
      this.makeCurrent(next);
    }
  }

  panelClosed(window: object): void {
    const open = this.windows.filter((candidate) => candidate.hasPanel());
    if (open.length === 0) {
      void vscode.commands.executeCommand('setContext', 'gitCheckout.panelOpen', false);
      void restoreBuiltInScm();
    }
    // A window without a panel for a repository other than the first has nothing left to show.
    const index = this.windows.indexOf(window as GitCheckoutPanelManager);
    if (index > 0 && !this.windows[index].hasPanel() && this.current !== this.windows[index]) {
      this.windows.splice(index, 1)[0].dispose();
    }
    this.pruneWindowsOfClosedRepositories();
  }

  /**
   * Drops the window of a repository that left the workspace once its panel is closed, and goes back to the
   * first window when that was the current one. A window that still has its panel open stays until it is
   * closed. Such a window would otherwise show the first repository, as a second window for it.
   */
  private pruneWindowsOfClosedRepositories(): void {
    const roots = this.gitService.getRepositories().map((repository) => repository.rootUri.fsPath);
    for (const window of this.windows.slice(1)) {
      const bound = window.selectedRepoRoot;
      if (bound === null || window.hasPanel() || roots.some((open) => sameWorktreePath(open, bound))) {
        continue;
      }
      log.debug('dropping the window of a repository that left the workspace');
      this.windows.splice(this.windows.indexOf(window), 1);
      if (this.current === window) {
        this.makeCurrent(this.windows[0]);
      }
      window.dispose();
    }
  }

  private makeCurrent(next: GitCheckoutPanelManager): void {
    if (next === this.current) {
      return;
    }
    log.debug('current window changed');
    this.current = next;
    for (const slot of Object.values(this.slots)) {
      slot.reload();
    }
    for (const list of Object.values(this.lists)) {
      list.reload();
    }
    next.activate();
  }

  /** The window for `repoRoot`, made when there is none yet. */
  private windowFor(repoRoot: string): GitCheckoutPanelManager {
    const known = this.windows.find((window) => {
      const root = window.windowRepoRoot();
      return root !== null && sameWorktreePath(root, repoRoot);
    });
    return known ?? this.open(repoRoot);
  }

  /** Makes `repoRoot` the repository commands, the sidebar and the bottom views work on. */
  async selectRepository(repoRoot: string): Promise<void> {
    const target = this.current.repositoryRoots().find((root) => sameWorktreePath(root, repoRoot));
    if (!target) {
      return;
    }
    this.makeCurrent(this.windowFor(target));
  }

  readonly onDidChangeRefs = this.refsChanged.event;

  dispose(): void {
    void vscode.commands.executeCommand('setContext', 'gitCheckout.panelOpen', false);
    void restoreBuiltInScm();
    for (const window of this.windows.splice(0)) {
      window.dispose();
    }
    for (const disposable of this.disposables.splice(0)) {
      disposable.dispose();
    }
  }

  /** The manager API for the rest of the extension: every call goes to the current window. */
  facade(): GitCheckoutPanelManager {
    const overrides: Record<PropertyKey, unknown> = {
      selectRepository: (root: string) => this.selectRepository(root),
      onDidChangeRefs: this.onDidChangeRefs,
      dispose: () => this.dispose(),
    };
    return new Proxy({} as GitCheckoutPanelManager, {
      get: (_target, property) => {
        if (property in overrides) {
          return overrides[property];
        }
        const value: unknown = Reflect.get(this.current, property);
        return typeof value === 'function' ? value.bind(this.current) : value;
      },
    });
  }
}
