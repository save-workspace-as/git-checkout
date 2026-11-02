import * as vscode from 'vscode';
import { l10nBodyAttribute } from '../shared/app/l10nAttribute';
import { autolinksBodyAttribute } from '../shared/history/autolinks';
import { readAutolinks } from '../features/history/githubLinkHost';
import type { HostMessage, WebviewMessage } from '../shared/protocol';
import { webviewImgSrc } from './webviewImgSrc';

export const COMMIT_FORM_VIEW_ID = 'gitCheckout.commitForm';
export const CHANGES_LIST_VIEW_ID = 'gitCheckout.changes';
export const TREE_VIEW_ID = 'gitCheckout.tree';
export const COMMIT_FILE_LIST_VIEW_ID = 'gitCheckout.commitFiles';

/** Queues host messages until the panel webview script has loaded. */
export class BottomViewSlot {
  private webview: vscode.Webview | undefined;
  private ready = false;
  private readonly pending: HostMessage[] = [];

  post(message: HostMessage): void {
    if (!this.webview) {
      return;
    }
    if (!this.ready) {
      this.pending.push(message);
      return;
    }
    void this.webview.postMessage(message);
  }

  /** The resolved view, for setting its title and description. */
  view: vscode.WebviewView | undefined;

  /** Set once the view is resolved: reloads its page so it starts over and says it is ready again. */
  private reloader: (() => void) | undefined;

  setReloader(reloader: (() => void) | undefined): void {
    this.reloader = reloader;
  }

  /** Starts the view's page over, so a new owner gets its ready message and can fill it in. */
  reload(): void {
    this.ready = false;
    this.pending.length = 0;
    this.reloader?.();
  }

  markReady(): void {
    this.ready = true;
    for (const message of this.pending.splice(0)) {
      void this.webview?.postMessage(message);
    }
  }

  bind(webview: vscode.Webview, onMessage: (message: WebviewMessage) => void): vscode.Disposable {
    this.webview = webview;
    this.ready = false;
    this.pending.length = 0;
    const listener = webview.onDidReceiveMessage((message: WebviewMessage) => onMessage(message));
    return {
      dispose: () => {
        listener.dispose();
        if (this.webview === webview) {
          this.webview = undefined;
          this.ready = false;
          this.pending.length = 0;
        }
      },
    };
  }
}

export type BottomSlot = Pick<BottomViewSlot, 'post' | 'markReady' | 'view'>;

/** A window's handle on a shared bottom view: it can only post to the view while the window owns it. */
export class ScopedBottomViewSlot implements BottomSlot {
  constructor(
    private readonly slot: BottomViewSlot,
    private readonly owns: () => boolean,
  ) {}

  post(message: HostMessage): void {
    if (this.owns()) {
      this.slot.post(message);
    }
  }

  markReady(): void {
    this.slot.markReady();
  }

  get view(): vscode.WebviewView | undefined {
    return this.owns() ? this.slot.view : undefined;
  }
}

/** Posts to every slot: the pages that make up one view each take the messages they need and ignore the rest. */
export class FanOutSlot implements BottomSlot {
  constructor(private readonly slots: readonly BottomSlot[]) {}

  post(message: HostMessage): void {
    this.slots.forEach((slot) => slot.post(message));
  }

  markReady(): void {
    this.slots.forEach((slot) => slot.markReady());
  }

  get view(): vscode.WebviewView | undefined {
    return this.slots.find((slot) => slot.view)?.view;
  }
}

export interface BottomViewSlots {
  commit: BottomViewSlot;
  treePreview: BottomViewSlot;
  /** The diff of the selected change. */
  changes: BottomViewSlot;
  /** The commit form of the Changes view. */
  changesForm: BottomViewSlot;
}

export function createBottomViewSlots(): BottomViewSlots {
  return {
    commit: new BottomViewSlot(), treePreview: new BottomViewSlot(),
    changes: new BottomViewSlot(), changesForm: new BottomViewSlot(),
  };
}

/** The page of a webview that runs one of the bundled scripts in `media/webview`. */
export function viewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  script: string,
  rootAttributes = '',
): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let i = 0; i < 32; i++) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'media', 'webview', script),
  );
  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'media', 'webview', 'styles.css'),
  );
  const codiconUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'media', 'webview', 'codicon.css'),
  );
  const cspSource = webview.cspSource;
  const allowGravatar = vscode.workspace.getConfiguration('gitCheckout').get<boolean>('graph.gravatar', false);
  const imgSrc = webviewImgSrc(cspSource, allowGravatar);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${imgSrc}; font-src ${cspSource}; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}' ${cspSource};" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${styleUri}" />
  <link rel="stylesheet" id="vscode-codicon-stylesheet" href="${codiconUri}" nonce="${nonce}" />
</head>
<body${l10nBodyAttribute(vscode.l10n.bundle)}${autolinksBodyAttribute(readAutolinks())}>
  <div id="root"${rootAttributes}></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

export function registerBottomPanelViews(
  context: vscode.ExtensionContext,
  slots: BottomViewSlots,
  onMessage: (message: WebviewMessage) => void,
): vscode.Disposable {
  const provider = (script: string, slot: BottomViewSlot, rootAttributes = ''): vscode.WebviewViewProvider => ({
    resolveWebviewView(view: vscode.WebviewView): void {
      view.webview.options = {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media', 'webview')],
      };
      const binding = slot.bind(view.webview, onMessage);
      view.onDidDispose(() => binding.dispose());
      slot.view = view;
      view.onDidDispose(() => {
        slot.view = undefined;
        slot.setReloader(undefined);
      });
      const load = (): void => {
        view.webview.html = viewHtml(view.webview, context.extensionUri, script, rootAttributes);
      };
      slot.setReloader(load);
      load();
    },
  });

  return vscode.Disposable.from(
    vscode.window.registerWebviewViewProvider(
      COMMIT_FORM_VIEW_ID,
      provider('changes.js', slots.changesForm, ' data-part="form"'),
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
  );
}
