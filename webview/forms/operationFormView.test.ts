import { strict as assert } from 'node:assert';
import { before, beforeEach, describe, it } from 'node:test';
import { focus, installDom, optionsOf, resetDom } from '../testing/dom';
import type {
  OperationFormDefinition, OperationFormHostMessage, OperationFormWebviewMessage,
  OperationFormModalHostMessage, OperationFormModalWebviewMessage,
} from '../../src/shared/forms/operationForm';

// The form is a template over a real DOM. VS Code Elements are not registered here, so their controls are
// plain elements that carry the properties the template sets.
type El = HTMLElement & Record<string, any>;

let mountOperationForm: typeof import('./operationFormView').mountOperationForm;
let mountOperationFormModal: typeof import('./operationFormModal').mountOperationFormModal;

before(async () => {
  installDom();
  ({ mountOperationForm } = await import('./operationFormView'));
  ({ mountOperationFormModal } = await import('./operationFormModal'));
});

beforeEach(resetDom);

const definition: OperationFormDefinition = {
  title: 'Create Branch',
  submitLabel: 'Create', checkedSubmitLabel: { field: 'checkout', label: 'Create and Checkout' },
  values: { name: 'agent/', checkout: true, localChanges: 'keep' },
  fields: [
    { id: 'name', type: 'text', label: 'Branch name', required: true },
    { id: 'checkout', type: 'checkbox', label: 'Checkout after creating' },
    { id: 'localChanges', type: 'radio', label: 'Local changes', options: [
      { value: 'keep', label: 'Keep' }, { value: 'discard', label: 'Discard' },
    ] },
  ],
};

function mount(form = definition) {
  const root = document.createElement('div');
  document.body.append(root);
  const sent: OperationFormWebviewMessage[] = [];
  const view = mountOperationForm(root, (message) => sent.push(message));
  view.applyHostMessage({ type: 'formInit', form });
  const find = (id: string) => root.querySelector(`[id="${id}"]`) as El;
  const submit = root.querySelector('[type="submit"]') as El;
  const formElement = root.querySelector('form')!;
  const type = (id: string, value: string) => {
    const element = find(id);
    element.value = value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const change = (id: string, set: Record<string, unknown>) => {
    const element = find(id);
    Object.assign(element, set);
    element.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const sendSubmit = () => formElement.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  return { root, sent, view, find, submit, formElement, type, change, sendSubmit };
}

describe('shared Settings-style operation form view', () => {
  it('renders selection-only dropdowns without custom inputs or picker buttons', () => {
    const h = mount({
      title: 'Create Branch', submitLabel: 'Create', values: { startPoint: 'main' },
      fields: [{ id: 'startPoint', type: 'text', label: 'Start point', suggestions: [
        { value: 'main' }, { value: 'refs/tags/v1', label: 'v1' },
      ] }],
    });
    const list = h.find('suggestions-startPoint');
    assert.equal(list.localName, 'vscode-single-select');
    assert.deepEqual(optionsOf(list).map((option) => option.value), ['main', 'refs/tags/v1']);
    assert.deepEqual(optionsOf(list).map((option) => option.selected), [true, false]);
    assert.equal(optionsOf(list)[1].label, 'refs/tags/v1 (v1)');
    assert.equal(list.value, 'main');
    assert.equal(h.root.querySelector('vscode-textfield'), null);
    assert.equal(h.root.querySelectorAll('vscode-button').length, 1);
    list.value = 'refs/tags/v1';
    list.dispatchEvent(new Event('change'));
    h.sendSubmit();
    const selected = h.sent.at(-1);
    if (selected?.type !== 'formSubmit') { throw new Error('Missing selected ref submission'); }
    assert.equal(selected.values.startPoint, 'refs/tags/v1');
    h.view.applyHostMessage({ type: 'formStatus', busy: true });
    assert.equal(list.hasAttribute('disabled'), true);
    h.view.applyHostMessage({ type: 'formStatus', busy: false });
    assert.equal(list.hasAttribute('disabled'), false);
  });

  it('puts the configured text in place of whitespace typed into a branch name, keeping the caret', () => {
    const withReplacement = (replaceWhitespace: string) => mount({
      ...definition,
      values: { name: '', checkout: true, localChanges: 'keep' },
      fields: [
        { id: 'name', type: 'text', label: 'Branch name', required: true, replaceWhitespace },
        ...definition.fields.slice(1),
      ],
    });
    const caretOf = (element: El, at: number) => {
      const carets: [number, number][] = [];
      element.wrappedElement = { selectionStart: at, setSelectionRange: (start: number, end: number) => carets.push([start, end]) };
      return carets;
    };
    const dash = withReplacement('-');
    const dashCaret = caretOf(dash.find('name-0'), 10);
    dash.type('name-0', 'feat/build pipeline');
    assert.equal(dash.find('name-0').value, 'feat/build-pipeline');
    assert.deepEqual(dashCaret.at(-1), [10, 10]);
    // Pasted text with tabs and several spaces is covered too, and a longer replacement moves the caret on.
    const underscore = withReplacement('__');
    const underscoreCaret = caretOf(underscore.find('name-0'), 3);
    underscore.type('name-0', 'a \tb');
    assert.equal(underscore.find('name-0').value, 'a____b');
    assert.deepEqual(underscoreCaret.at(-1), [5, 5]);
    // A field without a replacement keeps what was typed.
    const plain = mount();
    plain.type('name-0', 'keeps spaces');
    assert.equal(plain.find('name-0').value, 'keeps spaces');
  });

  it('renders read-only multiline operation fields as textareas', () => {
    const h = mount({
      title: 'Tag Details', submitLabel: 'Close', values: { tag: 'v1', message: 'subject\n\nbody' },
      fields: [
        { id: 'tag', type: 'text', label: 'Tag', readOnly: true },
        { id: 'message', type: 'text', label: 'Message', readOnly: true, multiline: true },
      ],
    });
    const message = h.find('message-0');
    assert.equal(message.localName, 'vscode-textarea');
    assert.equal(message.value, 'subject\n\nbody');
    assert.equal(message.hasAttribute('readonly'), true);
    assert.equal(h.submit.textContent?.trim(), 'Close');
  });

  it('splits a long form into tabs, and shows the tab of a field that needs fixing', () => {
    const h = mount({
      title: 'Repository Settings', submitLabel: 'Save', values: { name: 'Ada', prune: false, mode: 'a' },
      fields: [
        { id: 'name', type: 'text', label: 'Name' },
        { id: 'prune', type: 'checkbox', label: 'Prune' },
        { id: 'mode', type: 'radio', label: 'Mode', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] },
      ],
      tabs: [{ label: 'General', fields: ['name'] }, { label: 'Fetch', fields: ['prune', 'mode'] }],
    } as OperationFormDefinition);
    const headers = [...h.root.querySelectorAll('vscode-tab-header')].map((header) => header.textContent);
    assert.deepEqual(headers, ['General', 'Fetch']);
    const panels = [...h.root.querySelectorAll('vscode-tab-panel')];
    assert.equal(panels[0].querySelector('vscode-textfield')?.id, 'name-0');
    assert.equal(panels[1].querySelector('vscode-checkbox')?.id, 'prune-0');
    assert.equal(panels[1].querySelectorAll('vscode-radio').length, 2);
    assert.equal((h.root.querySelector('vscode-tabs') as El).selectedIndex, 0);
    h.view.applyHostMessage({ type: 'formStatus', busy: false, errors: { mode: 'Choose one' } });
    assert.equal((h.root.querySelector('vscode-tabs') as El).selectedIndex, 1);
  });

  it('shows a conflict notice and focuses the merge type dropdown', () => {
    const h = mount({
      title: 'Merge',
      notice: { kind: 'warning', message: 'Merge will cause conflicts' },
      submitLabel: 'Merge', values: { source: 'agent/feature', target: 'main', mergeType: 'Fast-forward if possible' },
      fields: [
        { id: 'source', type: 'text', label: 'Merge', readOnly: true },
        { id: 'target', type: 'text', label: 'Into', readOnly: true },
        { id: 'mergeType', type: 'text', label: 'Merge Type', suggestions: [
          { value: 'Default' }, { value: 'Fast-forward if possible' },
        ] },
      ],
    });
    assert.equal(h.root.querySelector('.operation-form-description'), null);
    const notice = h.root.querySelector('.operation-form-notice')!;
    assert.equal(notice.textContent, 'Merge will cause conflicts');
    assert.equal(notice.getAttribute('role'), 'status');
    assert.equal(h.find('source-0').hasAttribute('readonly'), true);
    assert.equal(h.find('target-0').hasAttribute('readonly'), true);
    assert.equal(focus.active, h.find('suggestions-mergeType'));
  });

  it('marks a successful preflight notice with the success class', () => {
    const h = mount({
      title: 'Rebase',
      notice: { kind: 'success', message: 'Rebase can complete without conflicts' },
      submitLabel: 'Submit', values: { source: 'main', target: 'agent/feature' },
      fields: [
        { id: 'source', type: 'text', label: 'Rebase', readOnly: true },
        { id: 'target', type: 'text', label: 'On', readOnly: true },
      ],
    });
    assert.equal(h.root.querySelector('.operation-form-notice')?.classList.contains('operation-form-notice-success'), true);
  });

  it('selects an available choice when conditional dropdown choices change', () => {
    const h = mount({
      title: 'Create Worktree', submitLabel: 'Create', values: { mode: 'new', startPoint: 'main' },
      fields: [
        { id: 'mode', type: 'radio', label: 'Branch', options: [
          { value: 'new', label: 'New' }, { value: 'existing', label: 'Existing' },
        ] },
        { id: 'startPoint', type: 'text', label: 'Start point', suggestions: [
          { value: 'HEAD', when: { field: 'mode', value: 'new' } },
          { value: 'topic', when: { field: 'mode', value: 'existing' } },
        ] },
      ],
    });
    const values = () => optionsOf(h.find('suggestions-startPoint')).map((option) => option.value);
    assert.deepEqual(values(), ['HEAD']);
    assert.equal(h.find('suggestions-startPoint').value, 'HEAD');
    h.change('mode-1', { value: 'existing' });
    assert.deepEqual(values(), ['topic']);
    assert.equal(h.find('suggestions-startPoint').value, 'topic');
    const validation = h.sent.at(-1);
    assert.equal(validation?.type, 'formValidate');
    if (validation?.type === 'formValidate') { assert.equal(validation.values.startPoint, 'topic'); }
  });

  it('keeps an empty dropdown disabled without falling back to a text input', () => {
    const h = mount({
      title: 'Save Stash', submitLabel: 'Save', values: { message: '' },
      fields: [{ id: 'message', type: 'text', label: 'Stash message', suggestions: [] }],
    });
    const list = h.find('suggestions-message');
    assert.equal(list.hasAttribute('disabled'), true);
    assert.equal(optionsOf(list)[0].label, 'None available');
    assert.equal(h.root.querySelector('vscode-textfield'), null);
    h.view.applyHostMessage({ type: 'formStatus', busy: true });
    h.view.applyHostMessage({ type: 'formStatus', busy: false });
    assert.equal(list.hasAttribute('disabled'), true);
  });

  it('shows a read-only pull destination without allowing edits', () => {
    const h = mount({
      title: 'Pull', submitLabel: 'Pull', values: { into: 'main' },
      fields: [{ id: 'into', type: 'text', label: 'Into', readOnly: true }],
    });
    assert.equal(h.find('into-0').value, 'main');
    assert.equal(h.find('into-0').hasAttribute('readonly'), true);
  });

  it('puts each field in a Settings-style form group with its label, and options in checkbox and radio groups', () => {
    const h = mount();
    const groups = [...h.root.querySelectorAll('.operation-form-field')] as El[];
    assert.equal(groups.length, 3);
    assert.ok(groups.every((group) => group.getAttribute('variant') === 'settings-group'));
    assert.equal(h.root.querySelector('vscode-form-container')?.children.length, 3);

    const [name, check, radio] = groups;
    const label = name.querySelector('vscode-label')!;
    assert.equal(label.getAttribute('for'), 'name-0');
    assert.equal(label.textContent, 'Branch name');
    assert.equal(label.nextElementSibling, h.find('name-0'));
    assert.ok(name.contains(h.find('error-name')));

    assert.equal(check.querySelector('vscode-label'), null);
    assert.equal(check.querySelector('vscode-checkbox-group')?.getAttribute('variant'), 'vertical');
    assert.equal(check.querySelector('vscode-checkbox-group > vscode-checkbox')?.id, 'checkout-0');
    assert.equal(check.querySelector('vscode-checkbox')?.getAttribute('label'), 'Checkout after creating');

    assert.equal(radio.getAttribute('aria-labelledby'), 'label-localChanges');
    assert.equal(radio.querySelector('vscode-label')?.getAttribute('for'), 'radios-localChanges');
    const options = [...radio.querySelectorAll('vscode-radio-group > vscode-radio')] as El[];
    assert.deepEqual(options.map((option) => option.getAttribute('label')), ['Keep', 'Discard']);
    assert.deepEqual(options.map((option) => option.checked), [true, false]);
  });

  it('puts checkboxes that share a group under one title', () => {
    const h = mount({
      title: 'Pull', submitLabel: 'Pull', values: { rebase: false, stash: true },
      fields: [
        { id: 'rebase', type: 'checkbox', group: 'Options', label: 'Rebase instead of merge' },
        { id: 'stash', type: 'checkbox', group: 'Options', label: 'Stash and reapply local changes' },
      ],
    });
    const group = h.root.querySelector('.operation-form-field')!;
    assert.equal(group.querySelector('vscode-label')?.textContent, 'Options');
    assert.equal(group.querySelector('vscode-label')?.getAttribute('for'), group.querySelector('vscode-checkbox-group')?.id);
    assert.deepEqual(
      [...group.querySelectorAll('vscode-checkbox-group > vscode-checkbox')].map((box) => box.getAttribute('label')),
      ['Rebase instead of merge', 'Stash and reapply local changes'],
    );
  });

  it('gives a checkbox its title above the box and its explanation beside the box', () => {
    const h = mount({
      title: 'Create Tag', submitLabel: 'Create', values: { a: true, b: false, c: '' },
      fields: [
        { id: 'a', type: 'checkbox', label: 'Sign commits', description: 'Sign every commit with your signing key.' },
        { id: 'b', type: 'checkbox', label: 'Second' },
        { id: 'c', type: 'text', label: 'Author name', description: 'The name recorded on commits in this repository.' },
      ],
    });
    const groups = [...h.root.querySelectorAll('.operation-form-field')];
    assert.equal(groups.length, 3);
    assert.equal(groups[0].querySelector('vscode-label')?.textContent, 'Sign commits');
    assert.equal(groups[0].querySelector('vscode-checkbox-group > vscode-checkbox')?.getAttribute('label'), 'Sign every commit with your signing key.');
    assert.equal(groups[0].querySelector('vscode-label')?.nextElementSibling, groups[0].querySelector('vscode-checkbox-group'));
    assert.equal(groups[1].querySelector('vscode-label'), null);
    assert.equal(groups[1].querySelector('vscode-checkbox-group > vscode-checkbox')?.getAttribute('label'), 'Second');
    const helper = groups[2].querySelector('vscode-form-helper');
    assert.equal(helper?.textContent, 'The name recorded on commits in this repository.');
    assert.equal(groups[2].querySelector('vscode-label')?.nextElementSibling, helper);
  });

  it('uses the same picker affordance for any text field and ignores outdated selections', () => {
    const h = mount({ ...definition, fields: [
      { id: 'location', type: 'text', label: 'Location', pickLabel: 'Choose Folder' },
    ], values: { location: '' } });
    const picker = [...h.root.querySelectorAll('vscode-button')].find((button) => button.textContent?.trim() === 'Choose Folder')!;
    picker.dispatchEvent(new Event('click'));
    const request = h.sent.at(-1);
    assert.equal(request?.type, 'formPick');
    if (request?.type !== 'formPick') { throw new Error('Missing picker request'); }
    assert.equal(request.field, 'location');
    h.view.applyHostMessage({ type: 'formStatus', busy: true });
    assert.equal(picker.hasAttribute('disabled'), true);
    h.view.applyHostMessage({ type: 'formPicked', field: 'location', version: request.version, value: '/repo/new' });
    assert.equal(h.find('location-0').value, '/repo/new');
    h.view.applyHostMessage({ type: 'formStatus', busy: false });
    assert.equal(picker.hasAttribute('disabled'), false);
    h.view.applyHostMessage({ type: 'formPicked', field: 'location', version: request.version, value: '/old' });
    assert.equal(h.find('location-0').value, '/repo/new');
  });

  it('shows the notice that comes with a picked value and clears it when none does', () => {
    const h = mount({ ...definition, fields: [
      { id: 'location', type: 'text', label: 'Location', pickLabel: 'Choose file' },
    ], values: { location: '' } });
    const picker = [...h.root.querySelectorAll('vscode-button')].find((button) => button.textContent?.trim() === 'Choose file')!;
    picker.dispatchEvent(new Event('click'));
    const request = h.sent.at(-1);
    if (request?.type !== 'formPick') { throw new Error('Missing picker request'); }
    h.view.applyHostMessage({
      type: 'formPicked', field: 'location', version: request.version, value: '/a.patch',
      notice: { kind: 'success', message: 'Patch can be applied without conflicts' },
    });
    assert.equal(h.root.querySelector('.operation-form-notice')?.textContent, 'Patch can be applied without conflicts');
    picker.dispatchEvent(new Event('click'));
    const next = h.sent.at(-1);
    if (next?.type !== 'formPick') { throw new Error('Missing picker request'); }
    h.view.applyHostMessage({ type: 'formPicked', field: 'location', version: next.version, value: '/b.patch', notice: null });
    assert.equal(h.root.querySelectorAll('.operation-form-notice').length, 0);
  });

  it('shows a failure once when it repeats the notice, and both when they differ', () => {
    const h = mount({
      title: 'Apply Patch', submitLabel: 'Apply', values: { location: '/a.patch' },
      notice: { kind: 'warning', message: 'Patch does not apply' },
      fields: [{ id: 'location', type: 'text', label: 'Location' }],
    });
    assert.equal(h.root.querySelectorAll('.operation-form-notice').length, 1);
    h.view.applyHostMessage({ type: 'formStatus', busy: false, error: 'Patch does not apply' });
    assert.equal(h.root.querySelectorAll('.operation-form-notice').length, 0);
    assert.equal(h.root.querySelector('.operation-form-error[role="alert"]')?.textContent, 'Patch does not apply');

    h.view.applyHostMessage({ type: 'formStatus', busy: false, error: 'The patch file is empty.' });
    assert.equal(h.root.querySelectorAll('.operation-form-notice').length, 1);
  });

  function mountModal() {
    const shell = document.createElement('div');
    const graph = document.createElement('section');
    const prior = document.createElement('button');
    const existingInert = document.createElement('section');
    (existingInert as El).inert = true;
    graph.append(prior);
    shell.append(graph, existingInert);
    document.body.append(shell);
    prior.focus();
    const sent: OperationFormModalWebviewMessage[] = [];
    const modal = mountOperationFormModal(shell, (message) => sent.push(message));
    modal.applyHostMessage({ type: 'operationFormOpen', sessionId: 1, form: definition } as OperationFormModalHostMessage);
    const find = (className: string) => shell.querySelector(`.${className}`) as El;
    const key = (target: Element, name: string, shiftKey = false) =>
      target.dispatchEvent(new KeyboardEvent('keydown', { key: name, shiftKey, bubbles: true, cancelable: true }));
    return {
      modal, shell, graph: graph as El, existingInert: existingInert as El, prior, sent, find, key,
      overlay: find('modal-overlay'), close: find('modal-close'),
      dialog: find('operation-form-modal'),
    };
  }

  describe('rebase-style operation form modal', () => {
    it('embeds the shared form in a labelled dialog and restores the graph and focus on close', () => {
      const h = mountModal();
      assert.equal(h.overlay.classList.contains('hidden'), false);
      assert.equal(h.dialog.getAttribute('role'), 'dialog');
      assert.equal(h.dialog.getAttribute('aria-modal'), 'true');
      assert.equal(h.dialog.getAttribute('aria-labelledby'), h.find('modal-title').id);
      assert.equal(h.find('modal-title').textContent, 'Create Branch');
      assert.equal(h.graph.inert, true);
      assert.equal((focus.active as Element | null)?.id, 'name-0');
      h.modal.applyHostMessage({ type: 'operationFormClose', sessionId: 99 });
      assert.equal(h.graph.inert, true);
      h.modal.applyHostMessage({ type: 'operationFormClose', sessionId: 1 });
      assert.equal(h.overlay.classList.contains('hidden'), true);
      assert.equal(h.graph.inert, false);
      assert.equal(h.existingInert.inert, true);
      assert.equal(focus.active, h.prior);
    });

    it('presses the main action on Enter from the dialog or a text field, but not from a button or a text area', () => {
      const h = mountModal();
      const submit = h.shell.querySelector('vscode-button[type="submit"]') as El;
      let presses = 0;
      submit.addEventListener('click', () => presses++);
      h.key(h.dialog, 'Enter');
      h.key(h.shell.querySelector('vscode-textfield')!, 'Enter');
      assert.equal(presses, 2);
      h.key(h.close, 'Enter');
      h.key(submit, 'Enter');
      assert.equal(presses, 2);
      submit.setAttribute('disabled', '');
      h.key(h.dialog, 'Enter');
      assert.equal(presses, 2);
    });

    for (const action of ['close', 'backdrop', 'Escape']) {
      it(`dismisses through ${action} without closing the Git Checkout view`, () => {
        const h = mountModal();
        if (action === 'close') { h.close.dispatchEvent(new Event('click')); }
        if (action === 'backdrop') { h.find('modal-backdrop').dispatchEvent(new Event('click')); }
        if (action === 'Escape') { h.key(h.overlay, 'Escape'); }
        assert.equal(h.sent.at(-1)?.sessionId, 1);
        assert.equal(h.sent.at(-1)?.message.type, 'formCancel');
        assert.ok(h.shell.contains(h.graph));
      });
    }

    it('traps focus, blocks dismissal while busy, and keeps failed drafts editable', () => {
      const h = mountModal();
      // The real button gives its host a tabindex; the stand-in gets one here.
      h.shell.querySelectorAll('vscode-button').forEach((button) => button.setAttribute('tabindex', '0'));
      const submit = h.shell.querySelector('[type="submit"]') as El;
      submit.focus();
      h.key(h.overlay, 'Tab');
      assert.equal(focus.active, h.close);
      h.key(h.overlay, 'Tab', true);
      assert.equal(focus.active, submit);
      h.modal.applyHostMessage({ type: 'operationFormUpdate', sessionId: 1, message: { type: 'formStatus', busy: true } });
      const count = h.sent.length;
      h.close.dispatchEvent(new Event('click'));
      h.find('modal-backdrop').dispatchEvent(new Event('click'));
      h.key(h.overlay, 'Escape');
      assert.equal(h.sent.length, count);
      assert.equal(h.close.disabled, true);
      assert.equal(focus.active, h.dialog);
      h.modal.applyHostMessage({
        type: 'operationFormUpdate', sessionId: 1, message: { type: 'formStatus', busy: false, error: 'Branch exists' },
      });
      assert.equal(h.close.disabled, false);
      assert.equal((h.shell.querySelector('[id="name-0"]') as El).value, 'agent/');
      assert.equal(focus.active, h.close);
    });

    it('shows the form again each time the modal opens, not only the first time', () => {
      const h = mountModal();
      h.modal.applyHostMessage({ type: 'operationFormClose', sessionId: 1 });
      assert.equal(h.shell.querySelector('.operation-form'), null);
      h.modal.applyHostMessage({ type: 'operationFormOpen', sessionId: 2, form: { ...definition, title: 'Pull' } });
      assert.ok(h.shell.querySelector('.operation-form'), 'the second form has a body');
      assert.equal((h.shell.querySelector('[id="name-0"]') as El).value, 'agent/');
      h.modal.applyHostMessage({ type: 'operationFormClose', sessionId: 2 });
      h.modal.applyHostMessage({ type: 'operationFormOpen', sessionId: 3, form: { ...definition, title: 'Save Stash' } });
      assert.ok(h.shell.querySelector('.operation-form'), 'the third form has a body');
    });

    it('does not apply stale messages to a later form', () => {
      const h = mountModal();
      h.modal.applyHostMessage({ type: 'operationFormOpen', sessionId: 2, form: { ...definition, title: 'Create Tag' } });
      h.modal.applyHostMessage({ type: 'operationFormClose', sessionId: 1 });
      assert.equal(h.overlay.classList.contains('hidden'), false);
      h.close.dispatchEvent(new Event('click'));
      assert.equal(h.sent.at(-1)?.sessionId, 2);
    });
  });

  it('renders accessible fields, defaults, and a dynamic submit action', () => {
    const h = mount();
    assert.equal(h.root.querySelector('h1, h2'), null);
    assert.equal(h.find('name-0').value, 'agent/');
    assert.equal(focus.active, h.find('name-0'));
    assert.equal(h.find('name-0').hasAttribute('required'), true);
    assert.equal(h.find('name-0').getAttribute('aria-describedby'), 'error-name');
    assert.equal(h.find('checkout-0').checked, true);
    assert.equal(h.find('localChanges-0').checked, true);
    assert.equal(h.submit.textContent?.trim(), 'Create and Checkout');
    h.change('checkout-0', { checked: false });
    assert.equal(h.submit.textContent?.trim(), 'Create');
  });

  it('shows only the latest inline validation and retains entered values', () => {
    const h = mount();
    h.type('name-0', 'agent/next');
    h.view.applyHostMessage({ type: 'formValidation', version: 1, errors: { name: 'Old error' } });
    assert.equal(h.find('error-name').textContent, '');
    h.view.applyHostMessage({ type: 'formValidation', version: 2, errors: { name: 'Already exists' } });
    assert.equal(h.find('error-name').textContent, 'Already exists');
    assert.equal(h.find('name-0').hasAttribute('invalid'), true);
    assert.equal(h.submit.hasAttribute('disabled'), true);
    assert.equal(h.find('name-0').value, 'agent/next');
    h.view.applyHostMessage({ type: 'formValidation', version: 2, errors: {} });
    assert.equal(h.submit.hasAttribute('disabled'), false);
  });

  it('submits all field values, disables the form while busy, and preserves it on failure', () => {
    const h = mount();
    h.type('name-0', 'topic');
    h.sendSubmit();
    const submission = h.sent.at(-1);
    assert.equal(submission?.type, 'formSubmit');
    if (submission?.type === 'formSubmit') {
      assert.equal(submission.values.name, 'topic');
      assert.equal(submission.values.localChanges, 'keep');
    }
    h.view.applyHostMessage({ type: 'formStatus', busy: true });
    assert.equal(h.find('name-0').hasAttribute('disabled'), true);
    assert.equal(h.submit.hasAttribute('disabled'), true);
    const count = h.sent.length;
    h.sendSubmit();
    assert.equal(h.sent.length, count);
    h.view.applyHostMessage({ type: 'formStatus', busy: false, error: 'Git failed' });
    assert.equal(h.find('name-0').hasAttribute('disabled'), false);
    assert.equal(h.find('name-0').value, 'topic');
    assert.equal(h.root.querySelector('[role="alert"]')?.textContent, 'Git failed');
  });

  it('omits the redundant Cancel button and supports Escape without submitting', () => {
    const h = mount();
    assert.equal([...h.root.querySelectorAll('vscode-button')].some((button) => button.textContent?.trim() === 'Cancel'), false);
    h.formElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    assert.equal(h.sent.at(-1)?.type, 'formCancel');
    assert.equal(h.sent.filter((message) => message.type === 'formSubmit').length, 0);
  });
});

void (undefined as unknown as OperationFormHostMessage);
