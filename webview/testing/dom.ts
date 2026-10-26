import { GlobalRegistrator } from '@happy-dom/global-registrator';

/** The element that has focus: these tests run VS Code Elements as plain elements, which always take focus. */
export const focus = { active: null as Element | null };

/**
 * A real DOM for a test file. The views are templates over the DOM, so a test mounts one and reads the result.
 * VS Code Elements are not registered here: their tags are plain elements that keep the properties set on them.
 * Call once before the views are imported; each test file runs in its own process.
 */
export function installDom(): void {
  if (!GlobalRegistrator.isRegistered) {
    GlobalRegistrator.register();
  }
  HTMLElement.prototype.focus = function focusElement(this: HTMLElement) { focus.active = this; };
  Object.defineProperty(document, 'activeElement', { get: () => focus.active, configurable: true });
}

export function resetDom(): void {
  focus.active = null;
  document.body.replaceChildren();
}

/** What a dropdown lists: its `vscode-option` children, as the template wrote them. */
export function optionsOf(select: Element): { value: string; label: string; description: string; selected: boolean; disabled: boolean }[] {
  return [...select.querySelectorAll('vscode-option')].map((option) => ({
    value: option.getAttribute('value') ?? '',
    label: option.textContent!.trim(),
    description: option.getAttribute('description') ?? '',
    selected: option.hasAttribute('selected'),
    disabled: option.hasAttribute('disabled'),
  }));
}
