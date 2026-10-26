import * as l10n from '@vscode/l10n';
import { html, nothing, render } from 'lit';
import { describeOperation } from '../src/shared/history/operationBanner';
import type { HistoryWebviewMessage, RepoOperationDto } from '../src/shared/history/historyProtocol';

type Post = (message: HistoryWebviewMessage) => void;

/**
 * The banner above the graph while a merge, rebase, cherry-pick or revert is unfinished. It stays until the
 * operation ends, so the user can fix the conflicts at their own pace and continue later.
 */
export function mountOperationBanner(post: Post): { element: HTMLElement; apply(operation: RepoOperationDto | undefined): void } {
  const element = document.createElement('div');
  element.className = 'operation-banner hidden';
  element.setAttribute('role', 'status');

  return {
    element,
    apply(operation): void {
      const model = operation ? describeOperation(operation) : undefined;
      element.classList.toggle('hidden', !model);
      render(model && html`
        <vscode-icon name="warning" aria-hidden="true"></vscode-icon>
        <span class="operation-banner-title">${model.title}</span>
        ${model.progress === undefined ? nothing : html`
          <vscode-progress-bar class="operation-banner-progress" max="100"
            aria-label=${l10n.t('Progress')} .value=${Math.round(model.progress * 100)}></vscode-progress-bar>`}
        <span class="operation-banner-message">${model.message}</span>
        <span class="operation-banner-actions">
          ${model.canAbort ? html`
            <vscode-button type="button" secondary @click=${() => post({ type: 'operationAbort' })}>${l10n.t('Abort')}</vscode-button>` : nothing}
          ${model.primary === null ? nothing : html`
            <vscode-button type="button"
              @click=${() => post({ type: model.primary === 'resolve' ? 'operationResolve' : 'operationContinue' })}
            >${model.primary === 'resolve' ? l10n.t('Resolve') : l10n.t('Continue')}</vscode-button>`}
        </span>`, element);
    },
  };
}
