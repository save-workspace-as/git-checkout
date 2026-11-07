import { strict as assert } from 'node:assert';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';

import { bindExtension, git, readyTree, repoRoot, waitFor } from './harness';
import { answer, cancelForm, submitForm } from './graphMenu';

describe('Housekeeping', () => {
  const ctx = bindExtension();
  const restore: (() => void)[] = [];

  beforeEach(async () => {
    await readyTree(ctx.api);
  });

  afterEach(() => {
    while (restore.length > 0) { restore.pop()?.(); }
  });

  it('Delete Merged Branches…: deletes the chosen merged branches and leaves unmerged ones', async () => {
    git('branch', 'merged-one');
    git('checkout', '-b', 'unmerged-one');
    writeFileSync(join(repoRoot(), 'unmerged.txt'), 'x\n');
    git('add', 'unmerged.txt');
    git('commit', '-m', 'unmerged work');
    git('checkout', '-');
    const command = vscode.commands.executeCommand('gitCheckout.deleteMergedBranches');
    const state = await waitFor('Delete Merged Branches modal', async () => ctx.api.operationFormState());
    const offered = state.form.fields.map((field) => ('label' in field ? field.label : ''));
    assert.ok(offered.includes('merged-one'));
    assert.ok(!offered.includes('unmerged-one'));
    await submitForm(ctx.api, command, 'Delete Merged Branches');
    const branches = git('branch', '--format=%(refname:short)').split('\n');
    assert.ok(!branches.includes('merged-one'));
    assert.ok(branches.includes('unmerged-one'));
  });

  it('Delete Merged Branches…: deletes nothing when the form is canceled, and refuses an empty selection', async () => {
    git('branch', 'merged-two');
    const command = vscode.commands.executeCommand('gitCheckout.deleteMergedBranches');
    const state = await waitFor('Delete Merged Branches modal', async () => ctx.api.operationFormState());
    const none = Object.fromEntries(Object.keys(state.form.values).map((id) => [id, false]));
    await ctx.api.sendPanelMessage({
      type: 'operationFormMessage', sessionId: state.sessionId,
      message: { type: 'formSubmit', values: { ...state.form.values, ...none } },
    });
    assert.ok(ctx.api.operationFormState(), 'the form stays open');
    await cancelForm(ctx.api, command, 'Delete Merged Branches');
    assert.ok(git('branch', '--format=%(refname:short)').split('\n').includes('merged-two'));
  });

  const cleanForm = async (): Promise<{ command: Thenable<unknown>; ids: Record<string, string> }> => {
    const command = vscode.commands.executeCommand('gitCheckout.cleanUntracked');
    const state = await waitFor('Clean Untracked Files modal', async () => ctx.api.operationFormState());
    const ids = Object.fromEntries(state.form.fields.flatMap((field) => ('label' in field && field.id.startsWith('untracked-') ? [[field.label, field.id]] : [])));
    return { command, ids };
  };

  it('Clean Untracked Files…: deletes the ticked untracked files after a confirmation', async () => {
    writeFileSync(join(repoRoot(), 'scratch.txt'), 'x\n');
    mkdirSync(join(repoRoot(), 'build'));
    writeFileSync(join(repoRoot(), 'build', 'out.js'), 'x\n');
    restore.push(answer('showWarningMessage', async (_message: unknown, _options: unknown, ...actions: unknown[]) => actions[0]));
    const { command, ids } = await cleanForm();
    assert.deepEqual(Object.keys(ids).sort(), ['build/', 'scratch.txt']);
    await submitForm(ctx.api, command, 'Clean Untracked Files', { [ids['build/']]: false });
    assert.equal(existsSync(join(repoRoot(), 'scratch.txt')), false);
    assert.equal(existsSync(join(repoRoot(), 'build', 'out.js')), true);
  });

  it('Clean Untracked Files…: keeps the form open and deletes nothing when the confirmation is declined', async () => {
    writeFileSync(join(repoRoot(), 'keep.txt'), 'x\n');
    restore.push(answer('showWarningMessage', async () => undefined));
    const { command } = await cleanForm();
    const state = await waitFor('the modal', async () => ctx.api.operationFormState());
    await ctx.api.sendPanelMessage({
      type: 'operationFormMessage', sessionId: state.sessionId, message: { type: 'formSubmit', values: state.form.values },
    });
    assert.ok(ctx.api.operationFormState(), 'the form stays open');
    assert.equal(existsSync(join(repoRoot(), 'keep.txt')), true);
    await cancelForm(ctx.api, command, 'Clean Untracked Files');
  });

  it('Clean Untracked Files…: lists ignored files only when asked, and deletes them with the others', async () => {
    writeFileSync(join(repoRoot(), '.gitignore'), 'cache.log\n');
    git('add', '.gitignore');
    git('commit', '-m', 'ignore');
    writeFileSync(join(repoRoot(), 'cache.log'), 'x\n');
    writeFileSync(join(repoRoot(), 'plain.txt'), 'x\n');
    restore.push(answer('showWarningMessage', async (_message: unknown, _options: unknown, ...actions: unknown[]) => actions[0]));
    const { command, ids } = await cleanForm();
    assert.deepEqual(Object.keys(ids), ['plain.txt']);
    await submitForm(ctx.api, command, 'Clean Untracked Files', { scope: 'all' });
    assert.equal(existsSync(join(repoRoot(), 'cache.log')), false);
    assert.equal(existsSync(join(repoRoot(), 'plain.txt')), false);
  });

  it('Run Garbage Collection: completes on a repository', async () => {
    await vscode.commands.executeCommand('gitCheckout.gc');
    assert.match(git('rev-parse', '--git-dir'), /\.git/);
  });

  it('Repository Statistics…: lists the counts and the contributors', async () => {
    let shown: { label: string; description?: string }[] = [];
    restore.push(answer('showQuickPick', async (items: unknown) => {
      shown = items as typeof shown;
      return undefined;
    }));
    await vscode.commands.executeCommand('gitCheckout.statistics');
    const labels = shown.map((item) => item.label);
    for (const label of ['Summary', 'Commits', 'Local branches', 'Tags', 'Contributors']) {
      assert.ok(labels.includes(label), label);
    }
    assert.equal(shown.find((item) => item.label === 'Commits')?.description, git('rev-list', '--count', 'HEAD'));
  });

  it('Sparse Checkout…: keeps only the chosen folders, and checks everything out again', async () => {
    for (const folder of ['keep', 'skip']) {
      mkdirSync(join(repoRoot(), folder));
      writeFileSync(join(repoRoot(), folder, 'file.txt'), folder);
    }
    git('add', '.');
    git('commit', '-m', 'folders');
    const folderIds = async (): Promise<Record<string, string>> => {
      const state = await waitFor('Sparse Checkout modal', async () => ctx.api.operationFormState());
      return Object.fromEntries(state.form.fields.flatMap((field) => ('label' in field && field.id.startsWith('folder-') ? [[field.label, field.id]] : [])));
    };
    const first = vscode.commands.executeCommand('gitCheckout.sparseCheckout');
    const ids = await folderIds();
    assert.deepEqual(Object.keys(ids).sort(), ['keep', 'skip']);
    await submitForm(ctx.api, first, 'Sparse Checkout', { [ids.skip]: false });
    assert.equal(existsSync(join(repoRoot(), 'skip', 'file.txt')), false);
    assert.equal(existsSync(join(repoRoot(), 'keep', 'file.txt')), true);

    await submitForm(ctx.api, vscode.commands.executeCommand('gitCheckout.sparseCheckout'), 'Sparse Checkout', { mode: 'disable' });
    assert.equal(existsSync(join(repoRoot(), 'skip', 'file.txt')), true);
  });
});

