import * as l10n from '@vscode/l10n';
import { html, render } from 'lit';
import type { VscodeButton } from '@vscode-elements/elements/dist/vscode-button/index.js';

export interface ModalShellOptions {
  /** Modifier classes added after `modal`. */
  className?: string;
  title: string;
  /** Called for the close button, a backdrop click and Escape. */
  onDismiss(): void;
}

/** What handles Enter itself: a button presses, a dropdown opens, a text area adds a line, the reword editor saves. */
const OWNS_ENTER = 'vscode-button, vscode-toolbar-button, vscode-single-select, vscode-textarea, button, a, textarea, dialog, [role="option"]';
/** The modal's main action: its filled, enabled button, which is not the close button. */
const PRIMARY = 'vscode-button:not([secondary]):not([disabled]):not([icon-only]):not(.hidden)';

const FOCUSABLE = [
  'button:not(:disabled)', 'input:not(:disabled):not(.hidden)', 'select:not(:disabled)', 'textarea:not(:disabled)',
  // VS Code Elements keep their focusable control in a shadow root; only a button's host has a tabindex.
  'vscode-button:not([disabled])', 'vscode-textfield:not([disabled])', 'vscode-textarea:not([disabled])', 'vscode-checkbox:not([disabled])',
  'vscode-radio[checked]:not([disabled])', 'vscode-tab-header', 'vscode-single-select:not([disabled])', 'vscode-toolbar-button', '[tabindex="0"]',
].join(', ');

/**
 * The frame every modal shares: overlay, backdrop, dialog, header with logo, title and close button,
 * and a body. It also owns what a modal must do: make the rest of the page inert while open, trap Tab,
 * close on Escape, press the main action on Enter, and give focus back when it closes.
 */
export function createModalShell(host: HTMLElement, options: ModalShellOptions) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay hidden';
  const titleId = `modal-title-${nextId++}`;
  render(html`
    <div class="modal-backdrop" @click=${() => options.onDismiss()}></div>
    <div class=${options.className ? `modal ${options.className}` : 'modal'} tabindex="-1"
      role="dialog" aria-modal="true" aria-labelledby=${titleId} @click=${(event: Event) => event.stopPropagation()}>
      <div class="modal-header">
        <h2 class="modal-title" id=${titleId}></h2>
        <span class="modal-extras"></span>
        <vscode-button type="button" class="modal-close" icon="close" icon-only
          aria-label=${l10n.t('Close')} title=${l10n.t('Close')} @click=${() => options.onDismiss()}></vscode-button>
      </div>
      <div class="modal-notes"></div>
      <div class="modal-body"></div>
    </div>`, overlay);
  const part = <T extends HTMLElement>(selector: string): T => overlay.querySelector<T>(selector)!;
  const dialog = part('.modal');
  const header = part('.modal-header');
  const title = part('.modal-title');
  title.textContent = options.title;
  const close = part<VscodeButton>('.modal-close');
  const body = part('.modal-body');
  /** Where a modal puts its own controls in the header, before the close button, and a line of text under it. */
  const extras = part('.modal-extras');
  const notes = part('.modal-notes');
  host.append(overlay);

  let previousFocus: HTMLElement | undefined;
  const inert = new Map<HTMLElement, boolean>();

  function dismiss(): void {
    options.onDismiss();
  }

  overlay.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      dismiss();
    } else if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey
      && event.target instanceof Element && !event.target.closest(OWNS_ENTER)) {
      // Enter presses the main action from anywhere else in the modal, including a text field, which would
      // otherwise submit on its own: stop that here so the form is not submitted twice.
      const primary = dialog.querySelector<HTMLElement>(PRIMARY);
      if (primary) {
        event.preventDefault();
        event.stopPropagation();
        primary.click();
      }
    } else if (event.key === 'Tab') {
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first) {
        event.preventDefault();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }, true);

  return {
    overlay, dialog, header, title, body, close, extras, notes,
    isOpen(): boolean {
      return !overlay.classList.contains('hidden');
    },
    show(): void {
      if (!overlay.classList.contains('hidden')) {
        return;
      }
      previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
      for (const element of Array.from(host.children)) {
        if (element instanceof HTMLElement && element !== overlay && !inert.has(element)) {
          inert.set(element, element.inert);
          element.inert = true;
        }
      }
      overlay.classList.remove('hidden');
      if (!dialog.contains(document.activeElement)) {
        dialog.focus();
      }
    },
    hide(): void {
      overlay.classList.add('hidden');
      for (const [element, wasInert] of inert) {
        element.inert = wasInert;
      }
      inert.clear();
      previousFocus?.focus();
      previousFocus = undefined;
    },
  };
}

let nextId = 0;
