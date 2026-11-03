import * as vscode from 'vscode';
import type { WebviewMessage } from '../shared/protocol';
import { viewHtml, type WebviewSlot } from './webviewSlots';

/** What a tab of the editor area shows: the page it runs, and the id VS Code knows it by. */
export interface EditorTabKind {
  viewType: string;
  /** The script in `media/webview` the page runs. */
  script: string;
  rootAttributes?: string;
}

/** The diff of a change picked in the Changes list. */
export const CHANGE_DIFF_TAB: EditorTabKind = { viewType: 'gitCheckout.diff', script: 'changes.js', rootAttributes: ' data-part="diff"' };
/** The diff of a file picked in a commit's changed files. */
export const COMMIT_DIFF_TAB: EditorTabKind = { viewType: 'gitCheckout.commitDiff', script: 'commit.js' };
/** The preview of a file picked in the File Tree. */
export const TREE_PREVIEW_TAB: EditorTabKind = { viewType: 'gitCheckout.treePreview', script: 'tree.js' };

/**
 * A diff or a preview in a tab of the editor area, like a file. One tab of each kind is shared by every window and
 * shows whichever file was picked last, in the page it runs.
 */
export class EditorTab implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private readonly visibility = new vscode.EventEmitter<void>();
  /** The tab was opened, closed, shown or hidden. */
  readonly onDidChangeVisible = this.visibility.event;

  /** Whether the tab is on screen. */
  get visible(): boolean {
    return this.panel?.visible === true;
  }

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly kind: EditorTabKind,
    private readonly slot: WebviewSlot,
    private readonly onMessage: (message: WebviewMessage) => void,
  ) {}

  /** Opens the tab, or brings it forward with a new title, without taking focus from the list. */
  show(title: string): void {
    if (this.panel) {
      this.panel.title = title;
      this.panel.reveal(this.panel.viewColumn, true);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      this.kind.viewType,
      title,
      { viewColumn: vscode.ViewColumn.Active, preserveFocus: true },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media', 'webview')],
      },
    );
    this.panel = panel;
    this.visibility.fire();
    panel.onDidChangeViewState(() => this.visibility.fire());
    const binding = this.slot.bind(panel.webview, this.onMessage);
    const load = (): void => {
      panel.webview.html = viewHtml(panel.webview, this.context.extensionUri, this.kind.script, this.kind.rootAttributes);
    };
    this.slot.setReloader(load);
    load();
    panel.onDidDispose(() => {
      binding.dispose();
      this.slot.setReloader(undefined);
      this.panel = undefined;
      this.visibility.fire();
    });
  }

  dispose(): void {
    this.panel?.dispose();
    this.visibility.dispose();
  }
}
