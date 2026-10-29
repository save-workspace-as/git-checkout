import { strict as assert } from 'node:assert';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';

import { bindExtension, git, readyTree, repoRoot, waitFor } from './harness';

describe('Undo Last Operation', () => {
  const ctx = bindExtension();

  function commit(file: string, text: string, message: string): void {
    writeFileSync(join(repoRoot(), file), text);
    git('add', file);
    git('commit', '-m', message);
  }

  async function undo(values: Record<string, string | boolean> = { mode: 'keep' }): Promise<void> {
    const command = vscode.commands.executeCommand('gitCheckout.undo');
    const state = await waitFor('Undo form', async () => ctx.api.operationFormState());
    assert.equal(state.form.title, 'Undo Last Operation');
    await ctx.api.sendPanelMessage({
      type: 'operationFormMessage', sessionId: state.sessionId,
      message: { type: 'formSubmit', values: { ...state.form.values, ...values } },
    });
    await command;
  }

  it('brings back the commits a hard reset dropped, and redoes the reset when run again', async () => {
    await readyTree(ctx.api);
    commit('a.txt', 'a\n', 'add a');
    commit('b.txt', 'b\n', 'add b');
    const tip = git('rev-parse', 'HEAD');
    git('reset', '--hard', 'HEAD~1');
    assert.equal(existsSync(join(repoRoot(), 'b.txt')), false);

    await undo();
    assert.equal(git('rev-parse', 'HEAD'), tip);
    assert.equal(existsSync(join(repoRoot(), 'b.txt')), true);

    await undo();
    assert.equal(git('rev-parse', 'HEAD'), git('rev-parse', `${tip}~1`));
  });

  it('puts back the commit an amend replaced', async () => {
    await readyTree(ctx.api);
    commit('a.txt', 'a\n', 'add a');
    const original = git('rev-parse', 'HEAD');
    git('commit', '--amend', '-m', 'add a, reworded');

    const command = vscode.commands.executeCommand('gitCheckout.undo');
    const state = await waitFor('Undo form', async () => ctx.api.operationFormState());
    assert.equal(state.form.fields.find((field) => field.id === 'operation')?.label, 'Amend');
    await ctx.api.sendPanelMessage({
      type: 'operationFormMessage', sessionId: state.sessionId,
      message: { type: 'formSubmit', values: state.form.values },
    });
    await command;

    assert.equal(git('rev-parse', 'HEAD'), original);
    assert.equal(git('log', '-1', '--format=%s'), 'add a');
  });

  it('puts the branch back after a rebase', async () => {
    await readyTree(ctx.api);
    commit('base.txt', 'base\n', 'base');
    git('switch', '-c', 'topic');
    commit('t.txt', 't\n', 'topic work');
    const before = git('rev-parse', 'HEAD');
    git('switch', 'main');
    commit('m.txt', 'm\n', 'main work');
    git('switch', 'topic');
    git('rebase', 'main');
    assert.notEqual(git('rev-parse', 'HEAD'), before);

    await undo();

    assert.equal(git('rev-parse', 'HEAD'), before);
  });

  it('keeps local changes while it goes back', async () => {
    await readyTree(ctx.api);
    commit('a.txt', 'a\n', 'add a');
    commit('b.txt', 'b\n', 'add b');
    git('reset', '--hard', 'HEAD~1');
    writeFileSync(join(repoRoot(), 'local.txt'), 'mine\n');

    await undo();

    assert.equal(git('log', '-1', '--format=%s'), 'add b');
    assert.match(git('status', '--porcelain'), /\?\? local\.txt/);
  });

  it('leaves the branch alone when the form is canceled', async () => {
    await readyTree(ctx.api);
    commit('a.txt', 'a\n', 'add a');
    git('reset', '--hard', 'HEAD~1');
    const head = git('rev-parse', 'HEAD');

    const command = vscode.commands.executeCommand('gitCheckout.undo');
    const state = await waitFor('Undo form', async () => ctx.api.operationFormState());
    await ctx.api.sendPanelMessage({
      type: 'operationFormMessage', sessionId: state.sessionId, message: { type: 'formCancel' },
    });
    await command;

    assert.equal(git('rev-parse', 'HEAD'), head);
  });

  it('is in the Repository dropdown', async () => {
    await readyTree(ctx.api);
    assert.ok((await vscode.commands.getCommands(true)).includes('gitCheckout.repo.0.undo'));
  });
});
