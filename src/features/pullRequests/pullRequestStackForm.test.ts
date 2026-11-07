import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { validateOperationForm } from '../../shared/forms/operationForm';
import type { StackCommit } from '../../shared/pullRequests/stackLayers';
import { stackForm, stackPlanFromValues, validateStackForm, type StackFormContext } from './pullRequestStackForm';

const commit = (sha: string, subject: string, branches: string[] = [], body = ''): StackCommit => ({ sha, subject, body, branches });
const context = (over: Partial<StackFormContext> = {}): StackFormContext => ({
  branch: 'feat/settings',
  baseName: 'main',
  existingBranches: new Set(['main', 'feat/settings']),
  commits: [
    commit('c1', 'Add schema', [], 'Needed first.'),
    commit('c2', 'Fix lint'),
    commit('c3', 'Add API', ['feat/settings-api']),
    commit('c4', 'Add page'),
  ],
  ...over,
});

describe('stackForm', () => {
  it('lists the commits newest first, with the newest as the branch itself and an existing branch as chosen', () => {
    const form = stackForm(context());
    assert.deepEqual(form.fields.map((field) => field.id), [
      'branch-3', 'title-3',
      'end-2', 'branch-2', 'title-2',
      'end-1', 'branch-1', 'title-1',
      'end-0', 'branch-0', 'title-0',
      'draft', 'link',
    ]);
    assert.equal(form.values['end-2'], true, 'a commit a branch already ends at starts chosen');
    assert.equal(form.values['end-1'], false);
    assert.equal(form.values['branch-3'], 'feat/settings');
    assert.equal(form.values['branch-2'], 'feat/settings-api');
    assert.equal(form.values['branch-0'], 'feat/settings-add-schema');
    assert.equal(form.values['title-0'], 'Add schema');
    assert.equal(form.values.draft, 'draft');
    assert.equal(form.values.link, true);
  });

  it('shows a commit\'s branch and title only while it ends a pull request, and fixes the names that already exist', () => {
    const fields = Object.fromEntries(stackForm(context()).fields.map((field) => [field.id, field]));
    assert.deepEqual(fields['branch-1'].when, { field: 'end-1', value: true });
    assert.deepEqual(fields['title-0'].when, { field: 'end-0', value: true });
    assert.equal(fields['branch-3'].when, undefined, 'the newest commit always ends the top pull request');
    assert.equal(fields['branch-3'].type === 'text' && fields['branch-3'].readOnly, true);
    assert.equal(fields['branch-2'].type === 'text' && fields['branch-2'].readOnly, true);
    assert.equal(fields['branch-1'].type === 'text' && fields['branch-1'].readOnly, false);
  });

  it('gives every new branch a name unlike the names that exist', () => {
    const form = stackForm(context({ existingBranches: new Set(['feat/settings', 'feat/settings-fix-lint']) }));
    assert.equal(form.values['branch-1'], 'feat/settings-fix-lint-2');
  });
});

describe('stackPlanFromValues', () => {
  it('makes a pull request for each chosen commit, each merging into the one below', () => {
    const ctx = context();
    const values = { ...stackForm(ctx).values, 'end-0': true, 'title-0': ' Schema ' };
    const plan = stackPlanFromValues(ctx, values);
    assert.deepEqual(plan.layers.map((l) => [l.branch, l.base, l.sha, l.created, l.title]), [
      ['feat/settings-add-schema', 'main', 'c1', true, 'Schema'],
      ['feat/settings-api', 'feat/settings-add-schema', 'c3', false, 'Add API'],
      ['feat/settings', 'feat/settings-api', 'c4', false, 'Add page'],
    ]);
    assert.deepEqual(plan.layers.map((l) => l.body), ['Needed first.', '- Fix lint\n- Add API', '']);
    assert.deepEqual([plan.draft, plan.link], [true, true]);
  });

  it('is one pull request from the branch when no other commit is chosen', () => {
    const ctx = context();
    const plan = stackPlanFromValues(ctx, { ...stackForm(ctx).values, 'end-2': false, draft: 'ready', link: false });
    assert.deepEqual(plan.layers.map((l) => [l.branch, l.base, l.created]), [['feat/settings', 'main', false]]);
    assert.deepEqual([plan.draft, plan.link], [false, false]);
  });

  it('leaves out the branch and title of a commit that is not chosen', () => {
    const ctx = context();
    const form = stackForm(ctx);
    const values = { ...form.values, 'branch-1': '', 'title-1': '' };
    assert.deepEqual(validateOperationForm(form, values).errors, {});
    assert.equal(stackPlanFromValues(ctx, values).layers.length, 2);
  });
});

describe('validateStackForm', () => {
  const ctx = context();
  const chosen = { ...stackForm(ctx).values, 'end-1': true, 'end-0': true };

  it('accepts the names the form starts with', () => {
    assert.deepEqual(validateStackForm(ctx, chosen), {});
  });

  it('refuses a new branch name that is empty, has a space, or is that of a branch that exists', () => {
    assert.ok(validateStackForm(ctx, { ...chosen, 'branch-1': '' })['branch-1']);
    assert.ok(validateStackForm(ctx, { ...chosen, 'branch-1': 'two words' })['branch-1']);
    assert.ok(validateStackForm(ctx, { ...chosen, 'branch-1': 'main' })['branch-1']);
  });

  it('refuses the base branch as a new name even when it is not a local branch', () => {
    const remoteOnly = context({ existingBranches: new Set(['feat/settings']) });
    const values = { ...stackForm(remoteOnly).values, 'end-1': true, 'branch-1': 'main' };
    assert.ok(validateStackForm(remoteOnly, values)['branch-1']);
  });

  it('refuses a title that is empty', () => {
    assert.deepEqual(Object.keys(validateStackForm(ctx, { ...chosen, 'title-1': '   ' })), ['title-1']);
  });

  it('refuses two pull requests from the same branch', () => {
    assert.deepEqual(Object.keys(validateStackForm(ctx, { ...chosen, 'branch-0': 'feat/x', 'branch-1': 'feat/x' })), ['branch-1']);
  });

  it('does not check a name that is not used', () => {
    assert.deepEqual(validateStackForm(ctx, { ...chosen, 'end-1': false, 'branch-1': 'two words' }), {});
  });
});
