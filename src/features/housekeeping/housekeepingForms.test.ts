import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { validateOperationForm } from '../../shared/forms/operationForm';
import { cleanChoice, cleanForm, sparseChoice, sparseForm, validateSparseForm, checklistValues, deleteMergedBranchesForm, validateCleanForm, MERGED_PREFIX, requireTicked, tickedItems } from './housekeepingForms';

describe('checklists in a form', () => {
  const items = ['a', 'b', 'c'];

  it('start ticked, and give back the ticked ones in order', () => {
    const values = checklistValues('x', items);
    assert.deepEqual(tickedItems('x', items, values), ['a', 'b', 'c']);
    assert.deepEqual(tickedItems('x', items, { ...values, 'x-1': false }), ['a', 'c']);
  });

  it('can start with some unticked', () => {
    assert.deepEqual(tickedItems('x', items, checklistValues('x', items, (item) => item !== 'b')), ['a', 'c']);
  });

  it('ask for one more when none is ticked', () => {
    const none = checklistValues('x', items, () => false);
    assert.deepEqual(Object.keys(requireTicked('x', items, none, 'pick one')), ['x-0']);
    assert.deepEqual(requireTicked('x', items, { ...none, 'x-2': true }, 'pick one'), {});
  });
});

describe('deleteMergedBranchesForm', () => {
  it('lists each branch as a ticked checkbox in one group', () => {
    const form = deleteMergedBranchesForm(['old', 'older']);
    assert.deepEqual(form.fields.map((field) => field.type === 'checkbox' && [field.label, field.group]), [
      ['old', 'Local branches already merged into the current branch'],
      ['older', 'Local branches already merged into the current branch'],
    ]);
    assert.deepEqual(validateOperationForm(form, form.values).errors, {});
    assert.equal(form.values[`${MERGED_PREFIX}-0`], true);
    assert.equal(form.submitLabel, 'Delete');
  });
});

describe('cleanForm', () => {
  const found = { untracked: ['scratch.txt', 'build/'], all: ['scratch.txt', 'build/', 'node_modules/'] };

  it('starts on untracked files, all ticked, and lists the ignored ones only for the wider scope', () => {
    const form = cleanForm(found);
    assert.equal(form.values.scope, 'untracked');
    assert.deepEqual(cleanChoice(found, form.values), { ignored: false, paths: ['scratch.txt', 'build/'] });
    assert.deepEqual(cleanChoice(found, { ...form.values, scope: 'all' }), { ignored: true, paths: ['scratch.txt', 'build/', 'node_modules/'] });
  });

  it('keeps each scope\'s own ticks', () => {
    const form = cleanForm(found);
    assert.deepEqual(cleanChoice(found, { ...form.values, 'untracked-0': false }).paths, ['build/']);
    assert.deepEqual(cleanChoice(found, { ...form.values, scope: 'all', 'ignored-2': false }).paths, ['scratch.txt', 'build/']);
  });

  it('starts on the wider scope when only ignored files are there', () => {
    assert.equal(cleanForm({ untracked: [], all: ['node_modules/'] }).values.scope, 'all');
  });

  it('refuses nothing ticked in the scope that is shown', () => {
    const form = cleanForm(found);
    const none = { ...form.values, 'untracked-0': false, 'untracked-1': false };
    assert.deepEqual(Object.keys(validateCleanForm(found, none)), ['untracked-0']);
    assert.deepEqual(validateCleanForm(found, { ...none, scope: 'all' }), {});
  });
});

describe('sparseForm', () => {
  const folders = ['docs', 'src', 'test'];

  it('offers only the folders while sparse checkout is off, all ticked', () => {
    const form = sparseForm({ folders, kept: [] });
    assert.deepEqual(form.fields.map((field) => field.id), ['folder-0', 'folder-1', 'folder-2']);
    assert.deepEqual(sparseChoice({ folders, kept: [] }, form.values), { kind: 'set', folders });
  });

  it('starts with the folders that are checked out, and offers to check out everything', () => {
    const state = { folders, kept: ['src'] };
    const form = sparseForm(state);
    assert.deepEqual(form.fields.map((field) => field.id), ['mode', 'folder-0', 'folder-1', 'folder-2']);
    assert.deepEqual(sparseChoice(state, form.values), { kind: 'set', folders: ['src'] });
    assert.deepEqual(sparseChoice(state, { ...form.values, mode: 'disable' }), { kind: 'disable' });
  });

  it('refuses no folder, except when everything is checked out again', () => {
    const state = { folders, kept: ['src'] };
    const form = sparseForm(state);
    const none = { ...form.values, 'folder-1': false };
    assert.deepEqual(Object.keys(validateSparseForm(state, none)), ['folder-0']);
    assert.deepEqual(validateSparseForm(state, { ...none, mode: 'disable' }), {});
  });
});
