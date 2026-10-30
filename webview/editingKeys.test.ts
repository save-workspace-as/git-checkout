import { strict as assert } from 'node:assert';
import { before, beforeEach, describe, it } from 'node:test';

import { installDom, resetDom } from './testing/dom';

let keepDeletingKeysInTextFields: typeof import('./editingKeys').keepDeletingKeysInTextFields;

before(async () => {
  installDom();
  ({ keepDeletingKeysInTextFields } = await import('./editingKeys'));
});
beforeEach(resetDom);

/** What VS Code's webview does: it listens on the window, after the document, and forwards what reaches it. */
function forwarded(target: Element, key: string): boolean {
  let reached = false;
  const listener = () => { reached = true; };
  window.addEventListener('keydown', listener);
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, composed: true, cancelable: true }));
  window.removeEventListener('keydown', listener);
  return reached;
}

describe('deleting keys in a text field', () => {
  it('stay in the field, so VS Code does not remove the selected commit while a person types', () => {
    keepDeletingKeysInTextFields(document);
    for (const tag of ['input', 'textarea']) {
      const field = document.createElement(tag);
      document.body.append(field);
      assert.equal(forwarded(field, 'Backspace'), false, `${tag} Backspace`);
      assert.equal(forwarded(field, 'Delete'), false, `${tag} Delete`);
    }
  });

  it('still reach VS Code from anywhere else, and every other key still does from a field', () => {
    keepDeletingKeysInTextFields(document);
    const row = document.createElement('div');
    const field = document.createElement('input');
    document.body.append(row, field);
    assert.equal(forwarded(row, 'Backspace'), true);
    assert.equal(forwarded(row, 'Delete'), true);
    assert.equal(forwarded(field, 'a'), true);
    assert.equal(forwarded(field, 'Enter'), true);
  });
});
