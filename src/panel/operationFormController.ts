import * as vscode from 'vscode';
import * as l10n from '@vscode/l10n';
import { createLogger } from '../log';
import {
  validateOperationForm,
  type OperationFormDefinition,
  type OperationFormErrors,
  type OperationFormHostMessage,
  type OperationFormModalHostMessage,
  type OperationFormModalWebviewMessage,
  type OperationFormValues,
} from '../shared/forms/operationForm';

const log = createLogger('operation-form');

export interface OperationFormHandler {
  validate(values: OperationFormValues): OperationFormErrors;
  submit(values: OperationFormValues): Promise<boolean>;
  pick?(field: string, values: OperationFormValues): Promise<string | undefined>;
  /** The notice to show once `field` was picked; `null` clears it. */
  noticeAfterPick?(field: string, value: string, values: OperationFormValues): Promise<OperationFormDefinition['notice'] | null>;
}

export type ShowOperationForm = (
  form: OperationFormDefinition,
  handler: OperationFormHandler,
) => Promise<boolean>;

interface FormSession {
  id: number;
  form: OperationFormDefinition;
  handler: OperationFormHandler;
  resolve(success: boolean): void;
  busy: boolean;
  closed: boolean;
}

export class OperationFormController implements vscode.Disposable {
  private session: FormSession | undefined;
  private nextId = 0;

  constructor(
    private readonly reveal: () => void,
    private readonly post: (message: OperationFormModalHostMessage) => void,
  ) {}

  current(): { sessionId: number; form: OperationFormDefinition } | undefined {
    return this.session ? { sessionId: this.session.id, form: this.session.form } : undefined;
  }

  readonly show: ShowOperationForm = (form, handler) => {
    this.reveal();
    if (this.session) {
      void vscode.window.showWarningMessage(l10n.t('Finish or cancel the current form before starting another operation.'));
      return Promise.resolve(false);
    }
    return new Promise((resolve) => {
      const session: FormSession = {
        id: ++this.nextId, form, handler, resolve, busy: false, closed: false,
      };
      this.session = session;
      this.post({ type: 'operationFormOpen', sessionId: session.id, form });
    });
  };

  dispose(): void {
    const session = this.session;
    if (!session) { return; }
    session.closed = true;
    this.session = undefined;
    if (!session.busy) {
      session.resolve(false);
    }
  }

  private update(session: FormSession, message: OperationFormHostMessage): void {
    if (!session.closed) {
      this.post({ type: 'operationFormUpdate', sessionId: session.id, message });
    }
  }

  private finish(session: FormSession, success: boolean): void {
    session.resolve(success);
    if (!session.closed) {
      this.post({ type: 'operationFormClose', sessionId: session.id });
    }
    session.closed = true;
    if (this.session === session) {
      this.session = undefined;
    }
  }

  private reportError(session: FormSession, error: unknown): void {
    log.error('operation form action failed', error);
    const detail = error instanceof Error ? error.message : String(error);
    if (session.closed) {
      void vscode.window.showErrorMessage(detail);
    } else {
      this.update(session, { type: 'formStatus', busy: false, error: detail });
    }
  }

  async handleWebviewMessage(envelope: OperationFormModalWebviewMessage): Promise<void> {
    const session = this.session;
    if (!session || envelope.sessionId !== session.id || session.busy) { return; }
    const message = envelope.message;
    if (!message || typeof message !== 'object') {
      log.warn('invalid operation form message');
      this.update(session, { type: 'formStatus', busy: false, error: l10n.t('Unsupported form request.') });
      return;
    }
    const { form, handler } = session;
    if (message.type === 'formReady') {
      this.update(session, { type: 'formInit', form });
    } else if (message.type === 'formCancel') {
      this.finish(session, false);
    } else if (message.type === 'formValidate' || message.type === 'formSubmit') {
      const result = validateOperationForm(form, message.values);
      if (Object.keys(result.errors).length === 0) {
        result.errors = handler.validate(result.values);
      }
      if (message.type === 'formValidate') {
        this.update(session, { type: 'formValidation', version: message.version, errors: result.errors });
        return;
      }
      if (Object.keys(result.errors).length > 0) {
        this.update(session, { type: 'formStatus', busy: false, errors: result.errors });
        return;
      }
      session.busy = true;
      this.update(session, { type: 'formStatus', busy: true });
      let success = false;
      try {
        success = await handler.submit(result.values);
      } catch (error) {
        this.reportError(session, error);
      } finally {
        session.busy = false;
      }
      if (success || session.closed) {
        this.finish(session, success);
      } else {
        this.update(session, { type: 'formStatus', busy: false });
      }
    } else if (message.type === 'formPick') {
      const field = form.fields.find((entry) => entry.id === message.field);
      const result = validateOperationForm(form, message.values);
      const malformed = form.fields.some((entry) =>
        typeof result.values[entry.id] !== (entry.type === 'checkbox' ? 'boolean' : 'string'));
      if (!handler.pick || field?.type !== 'text' || !field.pickLabel || malformed) {
        log.warn('invalid operation form picker request');
        this.update(session, { type: 'formStatus', busy: false, error: l10n.t('Unsupported form request.') });
        return;
      }
      session.busy = true;
      this.update(session, { type: 'formStatus', busy: true });
      try {
        const value = await handler.pick(field.id, result.values);
        if (value !== undefined) {
          const notice = await handler.noticeAfterPick?.(field.id, value, result.values);
          this.update(session, { type: 'formPicked', version: message.version, field: field.id, value, notice });
        }
      } catch (error) {
        this.reportError(session, error);
      } finally {
        session.busy = false;
        if (session.closed) {
          this.finish(session, false);
        } else {
          this.update(session, { type: 'formStatus', busy: false });
        }
      }
    } else {
      log.warn('unrecognized operation form message');
      this.update(session, { type: 'formStatus', busy: false, error: l10n.t('Unsupported form request.') });
    }
  }
}
