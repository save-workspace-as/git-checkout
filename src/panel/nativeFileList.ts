import * as vscode from 'vscode';
import { createLogger } from '../log';

const log = createLogger('fileList');

/** A row of a file list: a file, or a folder holding rows. */
export interface FileListNode {
  kind: 'file' | 'dir';
  /** Unique within the list, so a refresh keeps the selection and open folders. */
  key: string;
  label: string;
  children?: readonly FileListNode[];
}

export interface FileListOptions<N extends FileListNode> {
  item(node: N): vscode.TreeItem;
  /** A file was picked in the list (not by `select`); of a multi-selection, the one just added. */
  onPick(node: N): void;
}

/**
 * A native tree view of files: VS Code gives it multi-selection, keyboard navigation, the file icon theme
 * and inline buttons. A view is shared by every repository window and shows whatever the current one
 * gives it.
 */
export class NativeFileList<N extends FileListNode> implements vscode.Disposable {
  readonly view: vscode.TreeView<N>;
  private readonly changed = new vscode.EventEmitter<void>();
  private readonly disposables: vscode.Disposable[] = [this.changed];
  private nodes: N[] = [];
  private readonly byKey = new Map<string, N>();
  private readonly parents = new Map<string, N>();
  /** The file shown elsewhere (the diff or preview). Set by a pick in this list and by the host alike. */
  private selectedKey: string | undefined;
  private shownKeys = new Set<string>();
  private previousPicks = new Set<string>();

  private lastPick: { key: string; at: number } | undefined;

  /** What the view shows, also read by tests. */
  readonly provider: vscode.TreeDataProvider<N> = {
    onDidChangeTreeData: this.changed.event,
    getChildren: (node) => (node ? [...((node.children as N[] | undefined) ?? [])] : this.nodes),
    getParent: (node) => this.parents.get(node.key),
    getTreeItem: (node) => {
      const item = this.options.item(node);
      if (node.kind === 'file') {
        // A click runs this even on a row that is already selected, which a selection event never reports:
        // the row can be highlighted here while another list's change is the one on show.
        item.command = { command: this.pickCommand, title: '', arguments: [node] };
      }
      return item;
    },
  };

  private readonly pickCommand: string;

  constructor(
    viewId: string,
    private readonly options: FileListOptions<N>,
  ) {
    this.pickCommand = `gitCheckout.internal.pick.${viewId}`;
    this.view = vscode.window.createTreeView<N>(viewId, {
      treeDataProvider: this.provider,
      canSelectMany: true,
      showCollapseAll: true,
    });
    this.disposables.push(
      vscode.commands.registerCommand(this.pickCommand, (node: N) => this.clicked(node)),
      this.view,
      this.view.onDidChangeSelection((event) => this.picked(event.selection)),
      this.view.onDidChangeVisibility((event) => {
        if (event.visible) {
          this.reveal();
        }
      }),
    );
  }

  /** Replaces what the list shows; `null` empties it while no window owns the view. */
  show(nodes: readonly N[] | null, emptyMessage?: string): void {
    this.nodes = [...(nodes ?? [])];
    this.byKey.clear();
    this.parents.clear();
    const keys = new Set<string>();
    const index = (level: readonly N[], parent?: N): void => {
      for (const node of level) {
        this.byKey.set(node.key, node);
        if (parent) {
          this.parents.set(node.key, parent);
        }
        if (node.kind === 'file') {
          keys.add(node.key);
        }
        index((node.children as N[] | undefined) ?? [], node);
      }
    };
    index(this.nodes);
    // A different set of rows can make the selected one reappear; show it selected.
    const selectedAppeared = this.selectedKey !== undefined && keys.has(this.selectedKey) && !this.shownKeys.has(this.selectedKey);
    this.shownKeys = keys;
    this.view.message = this.nodes.length === 0 ? emptyMessage : undefined;
    this.changed.fire();
    if (selectedAppeared) {
      this.reveal();
    }
  }

  /** The window that owns the view changed: forget what it showed. */
  reload(): void {
    this.selectedKey = undefined;
    this.shownKeys = new Set();
    this.previousPicks = new Set();
    this.show(null);
  }

  /** Selects the file shown elsewhere, unless this list already has it selected. */
  select(key: string | null): void {
    if ((key ?? undefined) === this.selectedKey) {
      return;
    }
    this.selectedKey = key ?? undefined;
    this.reveal();
  }

  private reveal(): void {
    const node = this.selectedKey ? this.byKey.get(this.selectedKey) : undefined;
    if (!node || !this.view.visible) {
      return;
    }
    // Revealing selects the row without moving focus; the selection event it causes is the same file.
    Promise.resolve(this.view.reveal(node, { select: true, focus: false, expand: true })).catch((error: unknown) =>
      log.warn('could not reveal the selected file', error),
    );
  }

  /** A click on a file: show it, whatever this list already had selected. */
  private clicked(node: N): void {
    if (!this.byKey.has(node.key)) {
      return;
    }
    this.pick(node);
  }

  /** Shows `node`, unless the selection event of the same click has just done so. */
  private pick(node: N): void {
    const now = Date.now();
    if (this.lastPick?.key === node.key && now - this.lastPick.at < 500) {
      return;
    }
    this.lastPick = { key: node.key, at: now };
    this.selectedKey = node.key;
    this.options.onPick(node);
  }

  private picked(selection: readonly N[]): void {
    const files = selection.filter((node) => node.kind === 'file');
    // Of a multi-selection the diff follows the file that was just added to it.
    const added = files.filter((node) => !this.previousPicks.has(node.key));
    this.previousPicks = new Set(files.map((node) => node.key));
    const target = added[added.length - 1];
    if (!target || target.key === this.selectedKey) {
      return;
    }
    this.pick(target);
  }

  dispose(): void {
    for (const disposable of this.disposables.splice(0)) {
      disposable.dispose();
    }
  }
}

/** A window's handle on a shared list: it can only change the list while the window owns it. */
export class ScopedFileList<N extends FileListNode> {
  constructor(
    private readonly list: NativeFileList<N>,
    private readonly owns: () => boolean,
  ) {}

  show(nodes: readonly N[], emptyMessage?: string): void {
    if (this.owns()) {
      this.list.show(nodes, emptyMessage);
    }
  }

  select(key: string | null): void {
    if (this.owns()) {
      this.list.select(key);
    }
  }

  get view(): vscode.TreeView<N> | undefined {
    return this.owns() ? this.list.view : undefined;
  }
}
