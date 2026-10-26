import './installL10n';
import './elements';
import { mountCommitFilesView } from './details/commitFilesView';
import type { HostMessage, WebviewMessage } from './protocol';

declare function acquireVsCodeApi(): {
  postMessage(message: WebviewMessage): void;
};

const vscode = acquireVsCodeApi();

const root = document.getElementById('root')!;
root.className = 'commit-panel commit-files-panel';
const view = mountCommitFilesView(root, (message) => vscode.postMessage(message));

window.addEventListener('message', (event) => {
  view.applyHostMessage(event.data as HostMessage);
});

vscode.postMessage({ type: 'commitFilesReady' });
