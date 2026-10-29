import { strict as assert } from 'node:assert';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';

import { bindExtension, git, readyTree, repoRoot, waitFor } from './harness';

describe('Create stash', () => {
  const ctx = bindExtension();

  async function dirtyTrackedAndNewFile(): Promise<void> {
    const root = repoRoot();
    writeFileSync(join(root, 'tracked.txt'), 'base\n');
    git('add', 'tracked.txt');
    git('commit', '-m', 'track');
    writeFileSync(join(root, 'tracked.txt'), 'base\nedit\n');
    writeFileSync(join(root, 'new.txt'), 'new\n');
  }

  it('stashes the message and leaves new files when the option is off', async () => {
    await readyTree(ctx.api);
    await dirtyTrackedAndNewFile();

    await vscode.commands.executeCommand('gitCheckout.sidebar.createStash', {
      message: 'wip',
      includeNewFiles: false,
    });

    assert.match(git('stash', 'list'), /wip/);
    const status = git('status', '--porcelain');
    assert.match(status, /new\.txt/);
    assert.doesNotMatch(status, /tracked\.txt/);
  });

  it('includes new files when the option is on', async () => {
    await readyTree(ctx.api);
    await dirtyTrackedAndNewFile();

    await vscode.commands.executeCommand('gitCheckout.sidebar.createStash', {
      message: 'take new',
      includeNewFiles: true,
    });

    assert.match(git('stash', 'list'), /take new/);
    assert.equal(git('status', '--porcelain'), '');
  });

  it('applies a stash from the modal and deletes it when requested', async () => {
    await readyTree(ctx.api);
    writeFileSync(join(repoRoot(), 'apply.txt'), 'base\n');
    git('add', 'apply.txt');
    git('commit', '-m', 'apply base');
    writeFileSync(join(repoRoot(), 'apply.txt'), 'changed\n');
    git('stash', 'push', '-m', 'apply this');

    const command = vscode.commands.executeCommand('gitCheckout.sidebar.applyStash', { ref: 'stash@{0}' });
    const state = await waitFor('apply stash modal', async () => ctx.api.operationFormState());
    assert.equal(state.form.title, 'Apply Stash');
    await ctx.api.sendPanelMessage({
      type: 'operationFormMessage', sessionId: state.sessionId,
      message: { type: 'formSubmit', values: { ...state.form.values, deleteAfter: true } },
    });
    await command;
    assert.equal(git('stash', 'list'), '');
    assert.equal(git('show', 'HEAD:apply.txt'), 'base');
    assert.equal(readFileSync(join(repoRoot(), 'apply.txt'), 'utf8'), 'changed\n');
  });

  it('renames a stash through the modal', async () => {
    await readyTree(ctx.api);
    writeFileSync(join(repoRoot(), 'rename.txt'), 'saved\n');
    git('add', 'rename.txt');
    git('stash', 'push', '-m', 'old stash message');

    const command = vscode.commands.executeCommand('gitCheckout.sidebar.renameStash', { ref: 'stash@{0}' });
    const state = await waitFor('rename stash modal', async () => ctx.api.operationFormState());
    assert.equal(state.form.title, 'Rename Stash');
    await ctx.api.sendPanelMessage({
      type: 'operationFormMessage', sessionId: state.sessionId,
      message: { type: 'formSubmit', values: { message: 'new stash message' } },
    });
    try {
      await waitFor('renamed stash entry', async () =>
        git('stash', 'list').includes('new stash message') ? true : undefined, 5_000);
    } finally {
      if (ctx.api.operationFormState()) {
        await ctx.api.sendPanelMessage({
          type: 'operationFormMessage', sessionId: state.sessionId, message: { type: 'formCancel' },
        });
      }
      await command;
    }
    assert.match(git('stash', 'list'), /new stash message/);
  });

  it('opens the save as patch and delete stash modals', async () => {
    await readyTree(ctx.api);
    writeFileSync(join(repoRoot(), 'patch.txt'), 'saved\n');
    git('add', 'patch.txt');
    git('stash', 'push', '-m', 'patch stash');

    const patchCommand = vscode.commands.executeCommand('gitCheckout.sidebar.saveStashPatch', { ref: 'stash@{0}' });
    const patchForm = await waitFor('save stash patch modal', async () => ctx.api.operationFormState());
    assert.equal(patchForm.form.title, 'Create Patch');
    assert.equal(patchForm.form.values.revision, git('rev-parse', 'stash@{0}'));
    assert.equal(patchForm.form.values.format, 'diff');
    await ctx.api.sendPanelMessage({
      type: 'operationFormMessage', sessionId: patchForm.sessionId, message: { type: 'formCancel' },
    });
    await patchCommand;

    const deleteCommand = vscode.commands.executeCommand('gitCheckout.sidebar.dropStash', {
      kind: 'stash', ref: 'stash@{0}',
    });
    const deleteForm = await waitFor('delete stash modal', async () => ctx.api.operationFormState());
    assert.equal(deleteForm.form.title, 'Drop Stash');
    await ctx.api.sendPanelMessage({
      type: 'operationFormMessage', sessionId: deleteForm.sessionId,
      message: { type: 'formSubmit', values: deleteForm.form.values },
    });
    await deleteCommand;
    assert.equal(git('stash', 'list'), '');
  });
});
