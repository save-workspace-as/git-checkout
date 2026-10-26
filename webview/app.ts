import * as l10n from '@vscode/l10n';
import { html, render } from 'lit';
import { classMap } from 'lit/directives/class-map.js';
import { mountGraphView } from './graph/graphView';
import { mountOperationBanner } from './operationBanner';
import { mountRebaseView } from './rebase/rebaseView';
import { mountOperationFormModal } from './forms/operationFormModal';
import { mountHistoryModal } from './history/historyModal';
import type { HostMessage, UiState, WebviewMessage } from './protocol';
import type { PathHistoryHostMessage } from '../src/shared/history/pathHistoryProtocol';
import type { RebaseHostMessage } from '../src/shared/rebase/rebaseProtocol';
import { createModalShell } from './modalShell';

function emptyMessage(reason: NonNullable<UiState['emptyReason']>): string {
  switch (reason) {
    case 'noWorkspace':
      return l10n.t('Open a folder or workspace to use Git Checkout.');
    case 'gitDisabled':
      return l10n.t(
        'The built-in Git extension is disabled. Enable vscode.git (do not set git.enabled to false).',
      );
    case 'gitMissing':
      return l10n.t('vscode.git is not available on this extension host.');
    case 'apiUnavailable':
      return l10n.t('The Git API is not available yet. Try again after the repository loads.');
    case 'noRepository':
      return l10n.t('No Git repository is open in this workspace.');
  }
}

export function renderApp(
  root: HTMLElement,
  postMessage: (message: WebviewMessage) => void,
): {
  applyHostMessage(message: HostMessage): void;
} {
  let emptyReason: UiState['emptyReason'];
  const paintShell = (): void => { render(html`
    <div class="shell">
      <div class=${classMap({ body: true, dimmed: emptyReason !== undefined })}>
        <section class="pane pane-graph"></section>
      </div>
      <div class=${classMap({ 'empty-overlay': true, hidden: emptyReason === undefined })}>
        <h2>${l10n.t('Git Checkout')}</h2>
        <p>${emptyReason ? emptyMessage(emptyReason) : ''}</p>
      </div>
    </div>`, root); };
  root.replaceChildren();
  paintShell();
  const shell = root.querySelector<HTMLElement>('.shell')!;
  const graph = mountGraphView(root.querySelector<HTMLElement>('.pane-graph')!, postMessage);

  const operationBanner = mountOperationBanner(postMessage);

  const rebaseModal = createModalShell(shell, {
    className: 'rebase-editor-modal',
    title: l10n.t('Interactive Rebase'),
    onDismiss: () => postMessage({ type: 'rebaseDismiss' }),
  });

  let rebaseView: ReturnType<typeof mountRebaseView> | undefined;

  function showRebaseModal(): void {
    rebaseModal.show();
    if (!rebaseView) {
      rebaseView = mountRebaseView(rebaseModal.body, postMessage);
      postMessage({ type: 'rebaseReady' });
    }
  }

  function hideRebaseModal(): void {
    rebaseModal.hide();
  }

  function applyRebaseHostMessage(message: RebaseHostMessage): void {
    if (message.type === 'rebaseCommitDetails' || message.type === 'rebaseCommitDetailsError') {
      rebaseView?.applyHostMessage(message);
      return;
    }
    if (message.type === 'rebaseClose') {
      rebaseView?.applyHostMessage(message);
      hideRebaseModal();
      return;
    }
    showRebaseModal();
    rebaseView?.applyHostMessage(message);
  }

  shell.prepend(operationBanner.element);
  const operationForm = mountOperationFormModal(shell, postMessage);
  const history = mountHistoryModal(shell, postMessage);
  const blame = mountHistoryModal(shell, postMessage, { blame: true });
  /** The modal that opened last takes the messages that follow, until it closes. */
  let historyTarget: 'history' | 'blame' = 'history';

  function applyState(state: UiState): void {
    emptyReason = state.empty ? state.emptyReason : undefined;
    paintShell();
    operationBanner.apply(state.empty ? undefined : state.operation);
  }

  return {
    applyHostMessage(message: HostMessage): void {
      if (message.type === 'operationFormOpen' || message.type === 'operationFormUpdate' || message.type === 'operationFormClose') {
        operationForm.applyHostMessage(message);
        return;
      }
      if (message.type.startsWith('pathHistory')) {
        const historyMessage = message as PathHistoryHostMessage;
        if (historyMessage.type === 'pathHistoryOpen') {
          historyTarget = historyMessage.mode === 'blame' ? 'blame' : 'history';
        }
        if (historyTarget === 'blame') { blame.applyHostMessage(historyMessage); } else { history.applyHostMessage(historyMessage); }
        return;
      }
      if (message.type === 'commitDiffView') {
        history.setViewOptions(message.options);
        return;
      }
      if (message.type === 'bootstrap' || message.type === 'state') {
        applyState(message.state);
        return;
      }
      if (
        message.type === 'rebaseBootstrap' ||
        message.type === 'rebaseState' ||
        message.type === 'rebaseCommitDetails' ||
        message.type === 'rebaseCommitDetailsError' ||
        message.type === 'rebaseError' ||
        message.type === 'rebaseClose'
      ) {
        applyRebaseHostMessage(message);
        return;
      }
      if (
        message.type === 'graphPage' ||
        message.type === 'graphMeta' ||
        message.type === 'graphReveal' ||
        message.type === 'graphFocusSearch' ||
        message.type === 'graphFindResult' ||
        message.type === 'graphBisect' ||
        message.type === 'graphLoadFailed' ||
        message.type === 'graphMergeSide' ||
        message.type === 'graphAvatars' ||
        message.type === 'graphClear'
      ) {
        graph.handleHostMessage(message);
      }
    },
  };
}
