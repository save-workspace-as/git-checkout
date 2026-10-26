import './installL10n';
import './elements';
import { mountChangesView } from './details/changesView';
import type { HostMessage, WebviewMessage } from './protocol';

declare function acquireVsCodeApi(): {
  postMessage(message: WebviewMessage): void;
};

const vscode = acquireVsCodeApi();

const root = document.getElementById('root')!;
root.className = 'changes-panel';
const view = mountChangesView(root, (message) => vscode.postMessage(message));

window.addEventListener('message', (event) => {
  view.applyHostMessage(event.data as HostMessage);
});

vscode.postMessage({ type: 'changesReady' });
