import './installL10n';
import './elements';
import { html, render } from 'lit';
import { mountCommitTreePreview } from './details/commitTreePreview';
import type { HostMessage, WebviewMessage } from './protocol';

declare function acquireVsCodeApi(): {
  postMessage(message: WebviewMessage): void;
};

const vscode = acquireVsCodeApi();

// The Preview shares the panel frame of the Commit and Changes tabs. The file list beside it is a native view.
const root = document.getElementById('root')!;
root.className = 'commit-panel';
render(html`<div class="commit-tree-preview-host"></div>`, root);
const preview = mountCommitTreePreview(root.querySelector<HTMLElement>('.commit-tree-preview-host')!, (message) => vscode.postMessage(message));

window.addEventListener('message', (event) => {
  const message = event.data as HostMessage;
  if (message.type === 'editorTokenColors') {
    preview.setTokenColors(message.colors);
  } else if (message.type === 'commitDiffView') {
    preview.setViewOptions(message.options);
  } else if (message.type === 'commitTreeFilePreview' || message.type === 'commitTreePreviewClear') {
    preview.applyHostMessage(message);
  }
});

vscode.postMessage({ type: 'treeViewReady' });
