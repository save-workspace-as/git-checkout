import './installL10n';
import './elements';
import { renderApp } from './app';
import type { HostMessage, WebviewMessage } from './protocol';

declare function acquireVsCodeApi(): {
  postMessage(message: WebviewMessage): void;
};

const vscode = acquireVsCodeApi();
const app = renderApp(document.getElementById('root')!, (message) => vscode.postMessage(message));

window.addEventListener('message', (event) => {
  app.applyHostMessage(event.data as HostMessage);
});

vscode.postMessage({ type: 'ready' });
