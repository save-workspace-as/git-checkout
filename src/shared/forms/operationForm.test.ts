import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { isFieldVisible, operationFormSubmitLabel, validateOperationForm, type OperationFormDefinition } from './operationForm';

const form: OperationFormDefinition = {
  title: 'Create Branch',
  submitLabel: 'Create', checkedSubmitLabel: { field: 'checkout', label: 'Create and Checkout' },
  values: { name: '', startPoint: 'HEAD', checkout: true, localChanges: 'keep' },
  fields: [
    { id: 'name', label: 'Name', type: 'text', required: true },
    { id: 'startPoint', label: 'Start point', type: 'text' },
    { id: 'checkout', label: 'Checkout', type: 'checkbox' },
    { id: 'localChanges', label: 'Local changes', type: 'radio', options: [{ value: 'keep', label: 'Keep' }] },
  ],
};

describe('operation form contract', () => {
  it('validates the fields and omits unrecognized payload keys', () => {
    const result = validateOperationForm(form, { ...form.values, name: 'topic', unexpected: 'value' });
    assert.deepEqual(result, { values: { ...form.values, name: 'topic' }, errors: {} });
  });

  it('rejects missing, malformed, or unsupported field values', () => {
    for (const input of [null, [], 'input', {}, {
      name: false, startPoint: false, checkout: 'true', localChanges: 'wipe',
    }]) {
      assert.deepEqual(Object.keys(validateOperationForm(form, input).errors),
        ['name', 'startPoint', 'checkout', 'localChanges']);
    }
    assert.ok(validateOperationForm(form, form.values).errors.name);
    assert.deepEqual(validateOperationForm(form, { ...form.values, name: 'topic', startPoint: '' }).errors, {});
  });

  it('updates the primary action to match the selected checkout option', () => {
    assert.equal(operationFormSubmitLabel(form, form.values), 'Create and Checkout');
    assert.equal(operationFormSubmitLabel(form, { ...form.values, checkout: false }), 'Create');
  });

  it('only accepts listed dropdown choices available in the selected mode', () => {
    const dropdown: OperationFormDefinition = {
      title: 'Worktree', submitLabel: 'Create', values: { mode: 'new', ref: 'main' },
      fields: [
        { id: 'mode', type: 'radio', label: 'Mode', options: [
          { value: 'new', label: 'New' }, { value: 'existing', label: 'Existing' },
        ] },
        { id: 'ref', type: 'text', label: 'Branch', suggestions: [
          { value: 'main', when: { field: 'mode', value: 'new' } },
          { value: 'topic', when: { field: 'mode', value: 'existing' } },
        ] },
      ],
    };
    for (const ref of ['', 'HEAD~2', 'topic']) {
      assert.ok(validateOperationForm(dropdown, { mode: 'new', ref }).errors.ref);
    }
    assert.deepEqual(validateOperationForm(dropdown, dropdown.values).errors, {});
    assert.deepEqual(validateOperationForm(dropdown, { mode: 'existing', ref: 'topic' }).errors, {});
  });

  it('accepts only the empty value when no dropdown choices exist', () => {
    const dropdown: OperationFormDefinition = {
      title: 'Stash', submitLabel: 'Save', values: { message: '' },
      fields: [{ id: 'message', label: 'Message', type: 'text', suggestions: [] }],
    };
    assert.deepEqual(validateOperationForm(dropdown, dropdown.values).errors, {});
    assert.ok(validateOperationForm(dropdown, { message: 'Custom' }).errors.message);
  });

  describe('fields that depend on another field', () => {
    const dependent: OperationFormDefinition = {
      title: 'Stack', submitLabel: 'Create',
      values: { mode: 'stack', pick: true, name: '' },
      fields: [
        { id: 'mode', label: 'Mode', type: 'radio', options: [{ value: 'one', label: 'One' }, { value: 'stack', label: 'Stack' }] },
        { id: 'pick', label: 'Pick', type: 'checkbox', when: { field: 'mode', value: 'stack' } },
        { id: 'name', label: 'Name', type: 'text', required: true, when: [{ field: 'mode', value: 'stack' }, { field: 'pick', value: true }] },
      ],
    };

    it('shows a field only while every condition holds', () => {
      const [, pick, name] = dependent.fields;
      assert.equal(isFieldVisible(pick, { mode: 'stack' }), true);
      assert.equal(isFieldVisible(pick, { mode: 'one' }), false);
      assert.equal(isFieldVisible(name, { mode: 'stack', pick: true }), true);
      assert.equal(isFieldVisible(name, { mode: 'stack', pick: false }), false);
      assert.equal(isFieldVisible(dependent.fields[0], {}), true);
    });

    it('does not ask for a field that is out of the form, and keeps what it holds', () => {
      const hidden = { mode: 'stack', pick: false, name: '' };
      assert.deepEqual(validateOperationForm(dependent, hidden), { values: hidden, errors: {} });
      assert.deepEqual(Object.keys(validateOperationForm(dependent, { ...hidden, pick: true }).errors), ['name']);
      const loose = validateOperationForm(dependent, { mode: 'one' });
      assert.deepEqual(loose, { values: { mode: 'one', pick: false, name: '' }, errors: {} });
    });
  });
});
