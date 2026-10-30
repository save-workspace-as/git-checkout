/** Keys VS Code binds to an action on the selected commit, which a person typing must not trigger. */
const DELETING_KEYS = new Set(['Backspace', 'Delete']);

/** Whether the key press is aimed at something a person types in. */
function isTyping(event: KeyboardEvent): boolean {
  return event.composedPath().some((target) => {
    if (!(target instanceof HTMLElement)) { return false; }
    return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable;
  });
}

/**
 * Keeps Backspace and Delete in a text field from reaching VS Code, which binds them to removing the branch or stash
 * of the selected commit. The webview forwards every key it sees, so the key is stopped here; the field still
 * deletes the text, since stopping a key does not cancel what it does.
 */
export function keepDeletingKeysInTextFields(target: Document): void {
  target.addEventListener('keydown', (event) => {
    if (DELETING_KEYS.has(event.key) && isTyping(event)) {
      event.stopPropagation();
    }
  });
}
