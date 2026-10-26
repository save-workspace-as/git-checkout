import type { OperationFormModalHostMessage, OperationFormModalWebviewMessage } from '../../src/shared/forms/operationForm';
import { nothing, render } from 'lit';
import { createModalShell } from '../modalShell';
import { mountOperationForm } from './operationFormView';

export function mountOperationFormModal(
  host: HTMLElement,
  post: (message: OperationFormModalWebviewMessage) => void,
) {
  let sessionId: number | undefined;
  let busy = false;
  let view: ReturnType<typeof mountOperationForm> | undefined;

  const modal = createModalShell(host, {
    className: 'operation-form-modal',
    title: '',
    onDismiss() {
      if (sessionId !== undefined && !busy) {
        post({ type: 'operationFormMessage', sessionId, message: { type: 'formCancel' } });
      }
    },
  });

  function hide(): void {
    // Lit remembers what it drew in an element, so the body is cleared through it: emptying the DOM alone leaves
    // the next form to draw into nodes that are gone.
    render(nothing, modal.body);
    sessionId = undefined;
    view = undefined;
    modal.hide();
  }

  return {
    applyHostMessage(message: OperationFormModalHostMessage): void {
      if (message.type === 'operationFormOpen') {
        if (sessionId !== undefined) { hide(); }
        const id = message.sessionId;
        sessionId = id;
        busy = false;
        modal.close.disabled = false;
        modal.title.textContent = message.form.title;
        modal.show();
        view = mountOperationForm(modal.body, (inner) => post({
          type: 'operationFormMessage', sessionId: id, message: inner,
        }));
        view.applyHostMessage({ type: 'formInit', form: message.form });
      } else if (message.sessionId === sessionId) {
        if (message.type === 'operationFormClose') {
          hide();
        } else {
          if (message.message.type === 'formStatus') {
            busy = message.message.busy;
            modal.close.disabled = busy;
          }
          view?.applyHostMessage(message.message);
          if (message.message.type === 'formStatus') {
            if (busy) {
              modal.dialog.focus();
            } else if (document.activeElement === modal.dialog) {
              modal.close.focus();
            }
          }
        }
      }
    },
  };
}
