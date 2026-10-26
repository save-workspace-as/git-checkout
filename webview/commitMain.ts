import './installL10n';
import './elements';
import { html, render } from 'lit';
import { mountCommitDetailsView } from './details/commitDetailsView';
import type { HostMessage, WebviewMessage } from './protocol';

declare function acquireVsCodeApi(): {
  postMessage(message: WebviewMessage): void;
};

const vscode = acquireVsCodeApi();

function renderCommitView(
  root: HTMLElement,
): { applyHostMessage(message: HostMessage): void } {
  root.className = 'commit-panel';
  render(html`<div class="commit-details"></div>`, root);
  const commitDetails = mountCommitDetailsView(root.querySelector<HTMLElement>('.commit-details')!, (message) => vscode.postMessage(message));

  return {
    applyHostMessage(message: HostMessage): void {
      if (message.type === 'commitDetailsPreview') {
        commitDetails.showCommit(message.commit);
        return;
      }
      if (message.type === 'commitComparePreview') {
        commitDetails.showCompare(message.base, message.commit);
        return;
      }
      if (
        message.type === 'commitDetails' ||
        message.type === 'commitDetailsFileDiff' ||
        message.type === 'editorTokenColors' ||
        message.type === 'commitDiffView' ||
        message.type === 'commitDiffNavigate' ||
        message.type === 'commitDetailsShowFile'
      ) {
        commitDetails.applyHostMessage(message);
        return;
      }
    },
  };
}

const view = renderCommitView(document.getElementById('root')!);

window.addEventListener('message', (event) => {
  view.applyHostMessage(event.data as HostMessage);
});

vscode.postMessage({ type: 'commitViewReady' });
