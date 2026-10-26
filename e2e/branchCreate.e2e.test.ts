import { strict as assert } from 'node:assert';
import * as vscode from 'vscode';

import { bindExtension, findByRef, git, readyTree, waitFor } from './harness';

describe('Create branch', () => {
  const ctx = bindExtension();

  it('opens the interactive form over Git Checkout and cancels without creating a branch', async () => {
    await readyTree(ctx.api);
    const branches = git('branch', '--format=%(refname)');
    const command = vscode.commands.executeCommand('gitCheckout.sidebar.createBranch');
    const state = await waitFor('Create Branch modal', async () => ctx.api.operationFormState());
    const tab = await waitFor('Git Checkout tab', async () =>
      vscode.window.tabGroups.all.flatMap((group) => group.tabs).find(
        (entry) => entry.input instanceof vscode.TabInputWebview
          && entry.input.viewType.includes('gitCheckout.main'),
      ),
    );
    assert.equal(tab.label, 'Git Checkout');
    assert.equal(state.form.title, 'Create Branch');
    await ctx.api.sendPanelMessage({
      type: 'operationFormMessage', sessionId: state.sessionId, message: { type: 'formCancel' },
    });
    await command;
    assert.equal(ctx.api.operationFormState(), undefined);
    assert.ok(vscode.window.tabGroups.all.some((group) => group.tabs.includes(tab)));
    assert.equal(git('branch', '--format=%(refname)'), branches);
    assert.equal(git('rev-parse', '--abbrev-ref', 'HEAD'), 'main');
  });

  it('creates a branch and stays on the current one', async () => {
    await readyTree(ctx.api);
    await vscode.commands.executeCommand('gitCheckout.sidebar.createBranch', {
      name: 'topic',
      checkout: false,
      localChanges: 'keep',
    });

    assert.equal(git('rev-parse', '--abbrev-ref', 'HEAD'), 'main');
    assert.ok(git('rev-parse', '--verify', 'refs/heads/topic'));
    await waitFor('sidebar lists topic', async () =>
      findByRef((await ctx.api.sidebar.getChildren()) ?? [], 'topic') ? true : undefined,
    );
  });

  it('creates a branch from the modal without opening a separate form tab', async () => {
    await readyTree(ctx.api);
    const command = vscode.commands.executeCommand('gitCheckout.sidebar.createBranch');
    const state = await waitFor('Create Branch modal', async () => ctx.api.operationFormState());
    await ctx.api.sendPanelMessage({
      type: 'operationFormMessage', sessionId: state.sessionId,
      message: {
        type: 'formSubmit',
        values: { ...state.form.values, name: 'modal/topic', checkout: false },
      },
    });
    await command;
    assert.equal(ctx.api.operationFormState(), undefined);
    assert.ok(git('rev-parse', '--verify', 'refs/heads/modal/topic'));
    assert.equal(git('rev-parse', '--abbrev-ref', 'HEAD'), 'main');
  });

  it('checks out the new branch when asked', async () => {
    await readyTree(ctx.api);
    await vscode.commands.executeCommand('gitCheckout.sidebar.createBranch', {
      name: 'agent/next',
      startPoint: 'agent/feature',
      checkout: true,
      localChanges: 'keep',
    });

    assert.equal(git('rev-parse', '--abbrev-ref', 'HEAD'), 'agent/next');
    await waitFor('sidebar marks agent/next as HEAD', async () =>
      findByRef((await ctx.api.sidebar.getChildren()) ?? [], 'agent/next')?.isHead
        ? true
        : undefined,
    );
  });
});
