import { strict as assert } from 'node:assert';
import * as vscode from 'vscode';

import { bindExtension, git, loadTree, readyTree, repoRoot, type SidebarNode, waitFor } from './harness';

describe('Add remote', () => {
  const ctx = bindExtension();

  it('opens the compact modal, validates drafts, and adds a remote on submit', async () => {
    await readyTree(ctx.api);
    const command = vscode.commands.executeCommand('gitCheckout.sidebar.addRemote');
    const state = await waitFor('add remote modal', async () => ctx.api.operationFormState());
    assert.equal(state.form.title, 'Add Remote');
    assert.equal(state.form.values.name, 'origin');
    assert.equal(state.form.fields.find((field) => field.id === 'name')?.description, 'A short name for this remote, such as origin.');
    assert.ok(state.form.fields.some((field) => field.id === 'url'
      && field.pickLabel === 'Test connection'
      && field.description === 'The URL Git uses to fetch from and push to this repository.'));
    await ctx.api.sendPanelMessage({
      type: 'operationFormMessage', sessionId: state.sessionId,
      message: { type: 'formSubmit', values: { name: 'origin', url: '' } },
    });
    assert.ok(ctx.api.operationFormState());
    assert.equal(git('remote'), '');
    await ctx.api.sendPanelMessage({
      type: 'operationFormMessage', sessionId: state.sessionId,
      message: { type: 'formSubmit', values: { name: 'origin', url: repoRoot() } },
    });
    await command;
    assert.equal(git('remote', 'get-url', 'origin'), repoRoot());
    assert.equal(ctx.api.operationFormState(), undefined);
    await waitFor('sidebar lists origin', async () =>
      findRemote(await loadTree(ctx.api), 'origin'));
  });

  it('cancels the modal without adding a remote', async () => {
    await readyTree(ctx.api);
    const command = vscode.commands.executeCommand('gitCheckout.sidebar.addRemote');
    const state = await waitFor('add remote modal', async () => ctx.api.operationFormState());
    await ctx.api.sendPanelMessage({
      type: 'operationFormMessage', sessionId: state.sessionId, message: { type: 'formCancel' },
    });
    await command;
    assert.equal(git('remote'), '');
    assert.equal(ctx.api.operationFormState(), undefined);
  });

  it('adds a remote from the command argument', async () => {
    await readyTree(ctx.api);
    const url = repoRoot();
    await vscode.commands.executeCommand('gitCheckout.sidebar.addRemote', {
      name: 'contrib',
      url,
    });

    assert.equal(git('remote', 'get-url', 'contrib'), url);
    await waitFor('sidebar lists contrib', async () => {
      const nodes = await loadTree(ctx.api);
      return findRemote(nodes, 'contrib');
    });
  });

  it('opens Edit Remote with the current URL and updates it on submit', async () => {
    await readyTree(ctx.api);
    const initialUrl = repoRoot();
    const updatedUrl = `${repoRoot()}-updated`;
    await vscode.commands.executeCommand('gitCheckout.sidebar.addRemote', {
      name: 'origin', url: initialUrl,
    });
    const remote = await waitFor('origin remote', async () =>
      findRemote(await loadTree(ctx.api), 'origin'));
    const command = vscode.commands.executeCommand('gitCheckout.sidebar.editRemote', remote);
    const state = await waitFor('edit remote modal', async () => ctx.api.operationFormState());
    assert.equal(state.form.title, 'Edit Remote');
    assert.equal(state.form.fields.find((field) => field.id === 'name')?.description, 'The name of this remote.');
    assert.equal(state.form.values.name, 'origin');
    assert.equal(state.form.values.url, initialUrl);
    assert.ok(state.form.fields.some((field) => field.id === 'url' && field.pickLabel === 'Test connection'));
    await ctx.api.sendPanelMessage({
      type: 'operationFormMessage', sessionId: state.sessionId,
      message: { type: 'formSubmit', values: { name: 'origin', url: updatedUrl } },
    });
    await command;
    assert.equal(git('remote', 'get-url', 'origin'), updatedUrl);
    assert.equal(ctx.api.operationFormState(), undefined);
  });

  it('leaves the repository unchanged when the remote name is unsafe', async () => {
    await readyTree(ctx.api);
    await vscode.commands.executeCommand('gitCheckout.sidebar.addRemote', {
      name: '--force',
      url: repoRoot(),
    });
    assert.equal(git('remote'), '');
  });
});

function findRemote(nodes: readonly SidebarNode[], name: string): SidebarNode | undefined {
  const section = nodes.find((node) => node.id === 'section:remotes');
  return section?.children.find((node) => node.kind === 'remote' && node.ref === name);
}
